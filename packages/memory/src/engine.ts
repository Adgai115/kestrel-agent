/**
 * Memory engine — manages .agent-memory directory, MEMORY.md index,
 * memory proposals, review queue, search, and audit events.
 */

import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type {
  AuditSink,
  MemoryEntry,
  MemoryIndexEntry,
  MemoryProposal,
  MemoryReviewAction,
  MemorySearchResult,
  MemoryType,
  ReviewStatus,
} from "./types.js";

const MEMORY_DIR = ".agent-memory";
const INDEX_FILE = "MEMORY.md";
const PROPOSAL_DIR = "review-queue/pending";
const ACCEPTED_DIR = "review-queue/accepted";
const REJECTED_DIR = "review-queue/rejected";
const MAX_INDEX_LINES = 200;

export class MemoryEngine {
  private root: string;
  private auditSink: AuditSink | undefined;
  private requireAudit: boolean;

  constructor(cwd: string, options?: { auditSink?: AuditSink; requireAudit?: boolean }) {
    this.root = join(cwd, MEMORY_DIR);
    this.requireAudit = options?.requireAudit ?? true;
    this.auditSink =
      options?.auditSink ??
      ((e) => {
        const auditDir = join(this.root, "audit");
        if (!existsSync(auditDir)) mkdirSync(auditDir, { recursive: true });
        const logPath = join(auditDir, "audit.log");
        // MM-002: Hash chain — each entry includes SHA-256 of previous line
        let prevHash = "0000000000000000000000000000000000000000000000000000000000000000";
        if (existsSync(logPath)) {
          const prev = readFileSync(logPath, "utf-8").trim().split("\n").pop() ?? "";
          prevHash = createHash("sha256").update(prev).digest("hex");
        }
        const line = `${new Date().toISOString()} [${e.type}] ${e.name ?? ""}`;
        const hash = createHash("sha256")
          .update(prevHash + line)
          .digest("hex")
          .slice(0, 16);
        appendFileSync(logPath, `${hash}\t${line}\n`);
      });
    this.ensureDirs();
  }

  private ensureDirs(): void {
    const dirs = [
      this.root,
      join(this.root, "memories/user"),
      join(this.root, "memories/feedback"),
      join(this.root, "memories/project"),
      join(this.root, "memories/reference"),
      join(this.root, PROPOSAL_DIR),
      join(this.root, ACCEPTED_DIR),
      join(this.root, REJECTED_DIR),
    ];
    for (const d of dirs) {
      if (!existsSync(d)) mkdirSync(d, { recursive: true });
    }
  }

  // ==========================================================================
  // Propose Memory
  // ==========================================================================

  propose(entry: MemoryEntry, reason: string): MemoryProposal {
    if (!entry.name.match(/^[a-z0-9-]+$/)) {
      throw new Error("Memory name must be kebab-case");
    }

    if (this.requireAudit && !this.auditSink) {
      throw new Error("Audit sink is required. Configure auditSink or set requireAudit: false for development.");
    }

    // Scan all disk-written fields for secrets
    if (
      this.containsSecrets(entry.content) ||
      this.containsSecrets(entry.description) ||
      this.containsSecrets(reason)
    ) {
      throw new Error("Memory proposal rejected: contains secrets (API keys, tokens, passwords)");
    }

    const proposalPath = join(this.root, PROPOSAL_DIR, `${entry.name}.md`);
    if (existsSync(proposalPath)) {
      throw new Error(`Memory proposal "${entry.name}" already exists in review queue`);
    }

    const frontmatter = [
      "---",
      `name: ${entry.name}`,
      `description: ${entry.description}`,
      `type: ${entry.type}`,
      "status: pending",
      `proposedAt: ${entry.createdAt}`,
      `reason: ${reason}`,
      "---",
    ].join("\n");

    writeFileSync(proposalPath, `${frontmatter}\n\n${entry.content}`, "utf-8");

    this.auditSink?.({
      type: "memory.proposed",
      name: entry.name,
      memoryType: entry.type,
      timestamp: new Date().toISOString(),
    });

    return { entry, status: "pending", proposedAt: entry.createdAt, reason };
  }

  // ==========================================================================
  // Review Queue
  // ==========================================================================

  listPending(): MemoryProposal[] {
    return this.readProposals(PROPOSAL_DIR, "pending");
  }

  review(action: MemoryReviewAction): void {
    const reviewer = action.reviewer.trim();
    if (!reviewer || reviewer.length < 3) {
      throw new Error("Reviewer identity is required (minimum 3 characters)");
    }
    if (reviewer.length > 64) {
      throw new Error("Reviewer identity must be at most 64 characters");
    }
    const resolved = { ...action, reviewer };

    if (this.requireAudit && !this.auditSink) {
      throw new Error("Audit sink is required for memory review. Configure requireAudit: true with an audit callback.");
    }

    const pendingPath = join(this.root, PROPOSAL_DIR, `${resolved.name}.md`);
    if (!existsSync(pendingPath)) {
      throw new Error(`Proposal "${resolved.name}" not found in review queue`);
    }

    const content = readFileSync(pendingPath, "utf-8");
    const ts = new Date().toISOString();

    if (resolved.decision === "accepted") {
      const bodyMatch = content.match(/^---\n[\s\S]*?\n---\n\n([\s\S]*)$/);
      const body = bodyMatch?.[1] ?? "";
      const typeDir = this.getTypeDir(content);

      writeFileSync(join(this.root, typeDir, `${resolved.name}.md`), body, "utf-8");

      writeFileSync(
        join(this.root, ACCEPTED_DIR, `${resolved.name}.md`),
        content.replace(/status: pending/, `status: accepted\nreviewedBy: ${resolved.reviewer}\nreviewedAt: ${ts}`),
        "utf-8",
      );

      this.updateIndex(resolved.name, body, typeDir);

      this.auditSink?.({
        type: "memory.accepted",
        name: resolved.name,
        memoryType: this.getTypeField(content),
        reviewer: resolved.reviewer,
        timestamp: ts,
      });
    } else {
      writeFileSync(
        join(this.root, REJECTED_DIR, `${resolved.name}.md`),
        content.replace(/status: pending/, `status: rejected\nreviewedBy: ${resolved.reviewer}\nreviewedAt: ${ts}`),
        "utf-8",
      );

      this.auditSink?.({ type: "memory.rejected", name: resolved.name, reviewer: resolved.reviewer, timestamp: ts });
    }

    unlinkSync(pendingPath);
  }

  private getTypeDir(content: string): string {
    const type = this.getTypeField(content);
    return `memories/${type}`;
  }

  private static readonly VALID_TYPES = new Set(["user", "feedback", "project", "reference"]);

  private getTypeField(content: string): MemoryType {
    const match = content.match(/^type:\s*(\w+)/m);
    const raw = match?.[1] ?? "";
    if (!MemoryEngine.VALID_TYPES.has(raw)) {
      throw new Error(`Invalid memory type "${raw}". Expected one of: ${[...MemoryEngine.VALID_TYPES].join(", ")}`);
    }
    return raw as MemoryType;
  }

  // ==========================================================================
  // Index
  // ==========================================================================

  private updateIndex(name: string, content: string, typeDir: string): void {
    const firstLine = content.trim().split("\n")[0] ?? "";
    const description = firstLine.slice(0, 150).replace(/^#\s*/, "");
    const line = `- [${name}](memories/${typeDir.split("/").pop()}/${name}.md) — ${description}`;

    const indexPath = join(this.root, INDEX_FILE);
    let index = existsSync(indexPath) ? readFileSync(indexPath, "utf-8") : "# Memory Index\n\n";
    index += `${line}\n`;

    const lines = index.split("\n");
    if (lines.length > MAX_INDEX_LINES) {
      index = `${lines.slice(0, MAX_INDEX_LINES).join("\n")}\n`;
    }

    writeFileSync(indexPath, index, "utf-8");
  }

  // ==========================================================================
  // Search
  // ==========================================================================

  search(query: string): MemorySearchResult[] {
    const results: MemorySearchResult[] = [];
    const lowerQuery = query.toLowerCase();

    for (const type of ["user", "feedback", "project", "reference"] as MemoryType[]) {
      const dir = join(this.root, "memories", type);
      if (!existsSync(dir)) continue;

      for (const file of readdirSync(dir)) {
        if (!file.endsWith(".md")) continue;
        const content = readFileSync(join(dir, file), "utf-8");
        if (content.toLowerCase().includes(lowerQuery)) {
          const firstLine = content.trim().split("\n")[0] ?? "";
          results.push({
            name: file.replace(".md", ""),
            description: firstLine.replace(/^#\s*/, "").slice(0, 100),
            type,
            snippet: this.extractSnippet(content, lowerQuery),
          });
        }
      }
    }
    return results;
  }

  getIndex(): MemoryIndexEntry[] {
    const indexPath = join(this.root, INDEX_FILE);
    if (!existsSync(indexPath)) return [];

    const content = readFileSync(indexPath, "utf-8");
    const entries: MemoryIndexEntry[] = [];
    const re = /^- \[(.+?)\]\((.+?)\) — (.+)$/gm;
    let match = re.exec(content);
    while (match !== null) {
      const type = match[2]!.includes("/user/")
        ? "user"
        : match[2]!.includes("/feedback/")
          ? "feedback"
          : match[2]!.includes("/reference/")
            ? "reference"
            : "project";
      entries.push({ name: match[1]!, path: match[2]!, description: match[3]!, type });
      match = re.exec(content);
    }
    return entries;
  }

  // ==========================================================================
  // Helpers
  // ==========================================================================

  private readProposals(subdir: string, status: ReviewStatus): MemoryProposal[] {
    const dir = join(this.root, subdir);
    if (!existsSync(dir)) return [];

    return readdirSync(dir)
      .filter((f) => f.endsWith(".md"))
      .map((f) => {
        const content = readFileSync(join(dir, f), "utf-8");
        const name = f.replace(".md", "");
        const descMatch = content.match(/^description:\s*(.+)$/m);
        const typeMatch = content.match(/^type:\s*(.+)$/m);
        const reasonMatch = content.match(/^reason:\s*(.+)$/m);
        const dateMatch = content.match(/^proposedAt:\s*(.+)$/m);
        const bodyMatch = content.match(/^---\n[\s\S]*?\n---\n\n([\s\S]*)$/);

        return {
          entry: {
            name,
            description: descMatch?.[1] ?? "",
            type: (typeMatch?.[1] ?? "project") as MemoryType,
            content: bodyMatch?.[1] ?? "",
            createdAt: dateMatch?.[1] ?? new Date().toISOString(),
            updatedAt: dateMatch?.[1] ?? new Date().toISOString(),
          },
          status,
          proposedAt: dateMatch?.[1] ?? new Date().toISOString(),
          reason: reasonMatch?.[1] ?? "",
        };
      });
  }

  private containsSecrets(text: string): boolean {
    const patterns = [
      /\b(sk-[a-zA-Z0-9]{20,})\b/,
      /\b(eyJ[a-zA-Z0-9_-]{20,})\b/,
      /(?:api_key|apikey|secret|token|password)\s*[:=]\s*['"]?\S{8,}['"]?/i,
    ];
    return patterns.some((p) => p.test(text));
  }

  private extractSnippet(content: string, query: string): string {
    const idx = content.toLowerCase().indexOf(query);
    if (idx === -1) return content.slice(0, 150);
    const start = Math.max(0, idx - 40);
    const end = Math.min(content.length, idx + query.length + 100);
    return (start > 0 ? "..." : "") + content.slice(start, end) + (end < content.length ? "..." : "");
  }
}
