/**
 * Skill registry — loads, validates, and manages skills.
 *
 * Each skill is a directory containing:
 * - manifest.json (required)
 * - SKILL.md (optional, the skill instructions)
 * - examples/, scripts/ (optional)
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type {
  Skill,
  SkillAuditSink,
  SkillExecutionContext,
  SkillManifest,
  SkillProposal,
  SkillReviewStatus,
} from "./types.js";

const PROPOSAL_DIR = "skill-queue/pending";
const ACCEPTED_DIR = "skill-queue/accepted";
const REJECTED_DIR = "skill-queue/rejected";

export interface SkillRegistryConfig {
  /** Root directory for skills. Default: .kestrel/skills */
  skillsDir?: string;
  /** Audit event callback */
  auditSink?: SkillAuditSink;
  /**
   * Permission check before skill execution.
   * Called with (skillName, skillPermissions, executionContext).
   * Must return true to allow execution. Default: PermissionEngine gate (SK-001 hardened).
   */
  permissionCheck?: (skillName: string, permissions: string[], context: SkillExecutionContext) => boolean;
}

export class SkillRegistry {
  private dir: string;
  private skills = new Map<string, Skill>();
  private proposals = new Map<string, SkillProposal>();
  private auditSink?: SkillAuditSink;
  private config: SkillRegistryConfig;
  private _defaultGate: ((skillName: string, permissions: string[], context: SkillExecutionContext) => boolean) | null =
    null;
  private _defaultGatePromise: Promise<
    (skillName: string, permissions: string[], context: SkillExecutionContext) => boolean
  > | null = null;

  constructor(config: SkillRegistryConfig = {}) {
    this.config = config;
    this.dir = config.skillsDir ?? ".kestrel/skills";
    this.auditSink = config.auditSink;
    this.ensureDirs();
  }

  /** Lazily resolve default permission gate via PermissionEngine. */
  private async resolveDefaultGate(): Promise<
    (skillName: string, permissions: string[], context: SkillExecutionContext) => boolean
  > {
    if (this._defaultGate) return this._defaultGate;
    if (this._defaultGatePromise) return this._defaultGatePromise;

    this._defaultGatePromise = (async () => {
      try {
        const { PermissionEngine } = await import("@kestrel/permissions");
        const engine = new PermissionEngine();
        const gate = (_name: string, permissions: string[], context: SkillExecutionContext) => {
          for (const perm of permissions) {
            const result = engine.evaluate({
              subject: "local-user",
              channel: context.channel as any,
              tool: perm as any,
            });
            if (result.decision === "deny") return false;
          }
          return true;
        };
        this._defaultGate = gate;
        return gate;
      } catch {
        // PermissionEngine not available — allow all
        const allowAll = () => true;
        this._defaultGate = allowAll;
        return allowAll;
      }
    })();

    return this._defaultGatePromise;
  }

  // ==========================================================================
  // Directory Setup
  // ==========================================================================

  private ensureDirs(): void {
    for (const d of [
      this.dir,
      join(this.dir, PROPOSAL_DIR),
      join(this.dir, ACCEPTED_DIR),
      join(this.dir, REJECTED_DIR),
    ]) {
      if (!existsSync(d)) mkdirSync(d, { recursive: true });
    }
  }

  // ==========================================================================
  // Load & Validate
  // ==========================================================================

  /** Scan the skills directory and load all accepted skills. */
  load(): Skill[] {
    this.skills.clear();
    if (!existsSync(this.dir)) return [];

    for (const entry of readdirSync(this.dir)) {
      const fullPath = join(this.dir, entry);
      if (!statSync(fullPath).isDirectory()) continue;
      if (entry.startsWith("skill-queue")) continue;

      const manifestPath = join(fullPath, "manifest.json");
      if (!existsSync(manifestPath)) continue;

      try {
        const manifest = JSON.parse(readFileSync(manifestPath, "utf-8")) as SkillManifest;
        this.validateManifest(manifest);

        const skillMdPath = join(fullPath, "SKILL.md");
        const skillMd = existsSync(skillMdPath) ? readFileSync(skillMdPath, "utf-8") : "";

        const skill: Skill = {
          manifest,
          skillMd,
          path: fullPath,
          loadedAt: new Date().toISOString(),
        };
        this.skills.set(manifest.name, skill);
      } catch (_e) {
        // Skip invalid skills
      }
    }

    return this.list();
  }

  /** Validate a skill manifest. Throws on invalid. */
  validateManifest(manifest: unknown): asserts manifest is SkillManifest {
    const m = manifest as Record<string, unknown>;
    if (!m.name || typeof m.name !== "string") throw new Error("Skill manifest missing name");
    if (!m.version || typeof m.version !== "string") throw new Error("Skill manifest missing version");
    if (!m.description || typeof m.description !== "string") throw new Error("Skill manifest missing description");
    if (!Array.isArray(m.permissions)) throw new Error("Skill manifest missing permissions array");
    if (!Array.isArray(m.tools)) throw new Error("Skill manifest missing tools array");
    if (!m.riskLevel || !["low", "medium", "high", "critical"].includes(m.riskLevel as string)) {
      throw new Error("Skill manifest missing or invalid riskLevel");
    }
  }

  // ==========================================================================
  // List & Get
  // ==========================================================================

  list(): Skill[] {
    return [...this.skills.values()];
  }

  get(name: string): Skill | undefined {
    return this.skills.get(name);
  }

  // ==========================================================================
  // Propose & Review
  // ==========================================================================

  /** Propose a new skill. Goes to review queue. */
  propose(skill: Skill, reason: string): SkillProposal {
    if (this.skills.has(skill.manifest.name) || this.proposals.has(skill.manifest.name)) {
      throw new Error(`Skill "${skill.manifest.name}" already exists`);
    }

    this.validateManifest(skill.manifest);

    // Write to proposal dir
    const skillDir = join(this.dir, PROPOSAL_DIR, skill.manifest.name);
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, "manifest.json"), JSON.stringify(skill.manifest, null, 2), "utf-8");

    const proposal: SkillProposal = {
      skill,
      status: "pending",
      proposedAt: new Date().toISOString(),
      reason,
    };
    this.proposals.set(skill.manifest.name, proposal);

    this.auditSink?.({ type: "skill.proposed", name: skill.manifest.name, timestamp: proposal.proposedAt });

    return proposal;
  }

  /** List pending proposals. */
  listPending(): SkillProposal[] {
    return [...this.proposals.values()].filter((p) => p.status === "pending");
  }

  /** Accept or reject a pending skill proposal. */
  review(name: string, decision: SkillReviewStatus, reviewer: string): void {
    if (!reviewer) throw new Error("Reviewer identity is required");

    const proposal = this.proposals.get(name);
    if (proposal?.status !== "pending") {
      throw new Error(`No pending proposal for skill "${name}"`);
    }

    const ts = new Date().toISOString();

    if (decision === "accepted") {
      // Move skill from queue to main skills dir
      const _srcDir = join(this.dir, PROPOSAL_DIR, name);
      const destDir = join(this.dir, name);
      if (existsSync(destDir)) throw new Error(`Skill "${name}" already exists`);

      // Copy manifest with accepted status
      const acceptedManifest = { ...proposal.skill.manifest, reviewStatus: "accepted" };
      mkdirSync(destDir, { recursive: true });
      writeFileSync(join(destDir, "manifest.json"), JSON.stringify(acceptedManifest, null, 2), "utf-8");

      // Copy SKILL.md if present
      if (proposal.skill.skillMd) {
        writeFileSync(join(destDir, "SKILL.md"), proposal.skill.skillMd, "utf-8");
      }

      // Add to active skills with the accepted manifest
      this.skills.set(name, {
        ...proposal.skill,
        manifest: acceptedManifest as SkillManifest,
        path: destDir,
        loadedAt: ts,
      });
      proposal.status = "accepted";

      this.auditSink?.({ type: "skill.accepted", name, reviewer, timestamp: ts });
    } else {
      proposal.status = "rejected";
      writeFileSync(
        join(this.dir, REJECTED_DIR, `${name}.json`),
        JSON.stringify(
          { ...proposal.skill.manifest, reviewedBy: reviewer, reviewedAt: ts, decision: "rejected" },
          null,
          2,
        ),
        "utf-8",
      );
      this.auditSink?.({ type: "skill.rejected", name, reviewer, timestamp: ts });
    }

    this.proposals.set(name, proposal);
  }

  // ==========================================================================
  // Execution Audit
  // ==========================================================================

  /** Record a skill execution event. Checks permissions before allowing. */
  async recordExecution(name: string, context: SkillExecutionContext): Promise<void> {
    const skill = this.skills.get(name);
    if (!skill) throw new Error(`Skill "${name}" is not loaded`);

    // SK-001: Always check permissions — explicit callback or default PermissionEngine gate
    const gate = this.config.permissionCheck ?? (await this.resolveDefaultGate());
    const allowed = gate(name, skill.manifest.permissions, context);
    if (!allowed) {
      throw new Error(`Skill "${name}" execution denied: permissions not authorized for channel "${context.channel}"`);
    }

    this.auditSink?.({ type: "skill.executed", name, context });
  }

  /** Remove a skill. */
  remove(name: string): void {
    this.skills.delete(name);
    this.proposals.delete(name);
  }

  // ==========================================================================
  // Community: Publish / Discover / Install
  // ==========================================================================

  /** Publish a skill: export manifest + SKILL.md + examples to a sharable object. */
  publish(name: string): Record<string, unknown> | null {
    const skill = this.skills.get(name);
    if (!skill) return null;

    const dir = join(this.dir, name);
    const pkg: Record<string, unknown> = { manifest: skill.manifest };

    const skillMdPath = join(dir, "SKILL.md");
    if (existsSync(skillMdPath)) {
      pkg.skillMd = readFileSync(skillMdPath, "utf-8");
    }

    const examplesDir = join(dir, "examples");
    if (existsSync(examplesDir)) {
      const examples: Record<string, string> = {};
      for (const f of readdirSync(examplesDir)) {
        examples[f] = readFileSync(join(examplesDir, f), "utf-8");
      }
      pkg.examples = examples;
    }

    this.auditSink?.({ type: "skill.published", name });
    return pkg;
  }

  /**
   * Discover skills matching optional filters.
   * Returns sorted by version (descending).
   */
  discover(filter?: { name?: string; tag?: string; minVersion?: string }): SkillManifest[] {
    const results: SkillManifest[] = [];
    for (const skill of this.skills.values()) {
      const m = skill.manifest;
      if (filter?.name && !m.name.includes(filter.name)) continue;
      if (filter?.tag && !m.tags?.includes(filter.tag)) continue;
      if (filter?.minVersion && m.version < filter.minVersion) continue;
      results.push(m);
    }
    results.sort((a, b) => b.version.localeCompare(a.version));
    return results;
  }

  /**
   * Install a skill from a publish payload (manifest + optional files).
   * Creates the skill directory under this.skillsDir/<name>/.
   */
  install(payload: { manifest: SkillManifest; skillMd?: string; examples?: Record<string, string> }): Skill {
    const m = payload.manifest;
    this.validateManifest(m);

    const dir = join(this.dir, m.name);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

    writeFileSync(join(dir, "manifest.json"), JSON.stringify(m, null, 2), "utf-8");

    if (payload.skillMd) {
      writeFileSync(join(dir, "SKILL.md"), payload.skillMd, "utf-8");
    }
    if (payload.examples) {
      const examplesDir = join(dir, "examples");
      if (!existsSync(examplesDir)) mkdirSync(examplesDir, { recursive: true });
      for (const [fname, content] of Object.entries(payload.examples)) {
        writeFileSync(join(examplesDir, fname), content, "utf-8");
      }
    }

    const skill: Skill = {
      manifest: m,
      skillMd: payload.skillMd ?? "",
      path: dir,
      loadedAt: new Date().toISOString(),
    };
    this.skills.set(m.name, skill);
    this.auditSink?.({ type: "skill.installed", name: m.name });
    return skill;
  }
}
