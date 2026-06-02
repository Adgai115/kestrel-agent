/**
 * @kestrel/memory - Memory engine with audit events and review queue.
 */

export { MemoryEngine } from "./engine.js";
export { type ProposalScore, evaluateSecretRisk, scoreProposal } from "./scorer.js";
export {
  type DuplicateCheck,
  type ReviewState,
  checkDuplicate,
  serializeReviewState,
  textSimilarity,
} from "./deduper.js";
export type { LearnerConfig } from "./learner.js";
export { MemoryLearner } from "./learner.js";
export { type ExtractionResult, type LessonCandidate, extractLessons } from "./lesson-extractor.js";
export type {
  AuditSink,
  MemoryAuditEvent,
  MemoryEntry,
  MemoryIndexEntry,
  MemoryProposal,
  MemoryReviewAction,
  MemorySearchResult,
  MemoryType,
  ReviewStatus,
} from "./types.js";

export const KESTREL_MEMORY_VERSION = "0.0.1";
