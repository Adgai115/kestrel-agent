/**
 * MemoryLearner v1 — detects patterns in conversation transcripts and
 * auto-proposes memories to the review queue.
 *
 * Rules are intentionally simple regex matchers. A full ML-based learner
 * would be v2+; v1 catches high-signal conventions and preferences.
 */

import type { MemoryEngine } from "./engine.js";
import type { MemoryEntry, MemoryType } from "./types.js";

export interface LearnerConfig {
  /** Skip auto-propose for patterns with confidence below this. Default: 2 */
  minConfidence?: number;
  /** Max auto-proposals per session. Default: 5 */
  maxProposals?: number;
}

interface DetectedPattern {
  type: MemoryType;
  name: string;
  description: string;
  content: string;
  confidence: number;
}

export class MemoryLearner {
  private engine: MemoryEngine;
  private config: Required<LearnerConfig>;
  private proposalCount = 0;

  constructor(engine: MemoryEngine, config: LearnerConfig = {}) {
    this.engine = engine;
    this.config = { minConfidence: config.minConfidence ?? 2, maxProposals: config.maxProposals ?? 5 };
  }

  /**
   * Process conversation messages and auto-propose detected patterns.
   * Call this after a conversation turn completes (agent_end).
   */
  learn(messages: Array<{ role: string; content: string }>): string[] {
    if (this.proposalCount >= this.config.maxProposals) return [];

    const userTexts = messages.filter((m) => m.role === "user").map((m) => m.content);

    const combined = userTexts.join("\n");
    const patterns = this.detect(combined);

    const proposed: string[] = [];
    for (const p of patterns) {
      if (this.proposalCount >= this.config.maxProposals) break;
      if (p.confidence < this.config.minConfidence) continue;
      if (this.alreadyExists(p.name, p.content)) continue;
      // MM-001: Write gate — auto-propose only user/feedback types.
      // project/reference types require explicit human review.
      if (p.type !== "user" && p.type !== "feedback") continue;

      try {
        const entry: MemoryEntry = {
          name: p.name,
          description: p.description,
          type: p.type,
          content: p.content,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        this.engine.propose(entry, `Auto-detected from conversation (confidence: ${p.confidence})`);
        this.proposalCount++;
        proposed.push(p.name);
      } catch {
        // Name collision or secret detection — skip
      }
    }
    return proposed;
  }

  // ==========================================================================
  // Pattern Detection
  // ==========================================================================

  private detect(text: string): DetectedPattern[] {
    const results: DetectedPattern[] = [];

    // --- User preferences ---
    // "I prefer X", "I like X when Y", "I always/never X"
    const prefMatches = text.matchAll(
      /(?:^|\n|\.\s*)(?:I (?:prefer|like|want|always|never|don't like|dislike)\s+)([^.!?\n]{10,120})(?:[.!?\n]|$)/gi,
    );
    for (const m of prefMatches) {
      const detail = m[1]!.trim().replace(/^to\s+/, "");
      const slug = this.slugify(detail.slice(0, 40));
      results.push({
        type: "user",
        name: `pref-${slug}`,
        description: `User preference: ${detail.slice(0, 80)}`,
        content: `The user prefers: ${detail}`,
        confidence: 2,
      });
    }

    // --- Feedback: corrections ---
    // "don't do X", "no not that", "stop doing X"
    const correctionMatches = text.matchAll(
      /(?:^|\n|\.\s*)(?:don't\s+|do not\s+|no not\s+|stop doing\s+)([^.!?\n]{10,120})(?:[.!?\n]|$)/gi,
    );
    for (const m of correctionMatches) {
      const detail = m[1]!.trim();
      const slug = this.slugify(detail.slice(0, 40));
      results.push({
        type: "feedback",
        name: `correction-${slug}`,
        description: `User correction: avoid ${detail.slice(0, 60)}`,
        content: `**Rule:** ${detail}\n\n**Why:** User explicitly corrected this behavior.`,
        confidence: 3,
      });
    }

    // --- Feedback: confirmations ---
    // "yes exactly", "perfect keep doing that", "that's the right approach"
    const confirmMatches = text.matchAll(
      /(?:^|\n)(?:yes exactly|perfect[,.]?\s*(?:keep doing|that'?s)|that'?s the right|this is exactly what I)([^.!?\n]{10,120})?/gi,
    );
    for (const m of confirmMatches) {
      const detail = (m[1] ?? "this approach").trim();
      const slug = this.slugify(detail.slice(0, 40));
      results.push({
        type: "feedback",
        name: `confirmed-${slug}`,
        description: `Validated approach: ${detail.slice(0, 60)}`,
        content: `**Validated:** ${detail}\n\n**Why:** User confirmed this approach works well.`,
        confidence: 3,
      });
    }

    // --- Project conventions ---
    // "in this project we use X", "we use X for Y", "our convention is X"
    const conventionMatches = text.matchAll(
      /(?:^|\n|\.\s*)(?:in this (?:project|repo|codebase)|we (?:use|always|never)|our (?:convention|standard|pattern))\s+([^.!?\n]{15,150})(?:[.!?\n]|$)/gi,
    );
    for (const m of conventionMatches) {
      const detail = m[1]!.trim();
      const slug = this.slugify(detail.slice(0, 40));
      results.push({
        type: "project",
        name: `convention-${slug}`,
        description: `Project convention: ${detail.slice(0, 80)}`,
        content: `**Convention:** ${detail}`,
        confidence: 2,
      });
    }

    return results;
  }

  // ==========================================================================
  // Dedup
  // ==========================================================================

  private alreadyExists(name: string, content: string): boolean {
    const existing = this.engine.search(name);
    if (existing.length > 0) return true;

    // Also check by content similarity (first 60 chars)
    const snippet = content.slice(0, 60).toLowerCase();
    const byContent = this.engine.search(snippet);
    return byContent.length > 0;
  }

  // ==========================================================================
  // Helpers
  // ==========================================================================

  private slugify(text: string): string {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 50);
  }
}
