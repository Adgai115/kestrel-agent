/**
 * Memory engine types.
 *
 * Four memory categories as defined in SOP Section 9:
 * - user: long-term preferences, knowledge level
 * - feedback: corrections and guidance on agent behavior
 * - project: goals, architecture decisions, bugs, context
 * - reference: pointers to external systems
 */

export type MemoryType = "user" | "feedback" | "project" | "reference";
export type ReviewStatus = "pending" | "accepted" | "rejected";

export interface MemoryEntry {
  /** Slug used as filename (kebab-case) */
  name: string;
  /** One-line summary for index */
  description: string;
  type: MemoryType;
  /** Full markdown content */
  content: string;
  createdAt: string;
  updatedAt: string;
}

export interface MemoryProposal {
  entry: MemoryEntry;
  status: ReviewStatus;
  proposedAt: string;
  reason: string;
}

export interface MemoryIndexEntry {
  name: string;
  description: string;
  type: MemoryType;
  path: string;
}

export interface MemorySearchResult {
  name: string;
  description: string;
  type: MemoryType;
  /** Snippet of matching content */
  snippet: string;
}

export interface MemoryReviewAction {
  name: string;
  decision: "accepted" | "rejected";
  /** Identity of the reviewer (required). */
  reviewer: string;
  /** Optional review note. */
  reason?: string;
}

export type MemoryAuditEvent =
  | { type: "memory.proposed"; name: string; memoryType: MemoryType; timestamp: string }
  | { type: "memory.accepted"; name: string; memoryType: MemoryType; reviewer: string; timestamp: string }
  | { type: "memory.rejected"; name: string; reviewer: string; timestamp: string };

export type AuditSink = (event: MemoryAuditEvent) => void;
