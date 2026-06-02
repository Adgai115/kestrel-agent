/**
 * KCP-0704: Deduper for memory proposals.
 *
 * Detects duplicate or near-duplicate proposals across the review queue
 * and accepted memories, supporting merge/archive behavior.
 */

export interface DuplicateCheck {
  isDuplicate: boolean;
  similarName?: string;
  similarity: number;
}

/**
 * Simple word-overlap similarity check.
 * Returns 0-1 score where 1 = identical content.
 */
export function textSimilarity(a: string, b: string): number {
  const aWords = new Set(a.toLowerCase().split(/\s+/).filter(Boolean));
  const bWords = new Set(b.toLowerCase().split(/\s+/).filter(Boolean));
  if (aWords.size === 0 && bWords.size === 0) return 1;
  const intersection = new Set([...aWords].filter((w) => bWords.has(w)));
  const union = new Set([...aWords, ...bWords]);
  return intersection.size / (union.size || 1);
}

const SIMILARITY_THRESHOLD = 0.7;

/**
 * Check if a proposal duplicates an existing entry by content or name.
 */
export function checkDuplicate(
  name: string,
  content: string,
  existing: Array<{ name: string; content: string }>,
): DuplicateCheck {
  for (const entry of existing) {
    // Name match
    if (entry.name === name) {
      return { isDuplicate: true, similarName: entry.name, similarity: 1 };
    }
    // Content similarity
    const sim = textSimilarity(content, entry.content);
    if (sim >= SIMILARITY_THRESHOLD) {
      return { isDuplicate: true, similarName: entry.name, similarity: sim };
    }
  }
  return { isDuplicate: false, similarity: 0 };
}

// KCP-0706: Review state persistence helpers
export interface ReviewState {
  proposalName: string;
  status: "pending" | "accepted" | "rejected";
  reviewer?: string;
  reviewedAt?: string;
  score?: number;
}

/**
 * Convert a review state to a serializable record for persistence.
 */
export function serializeReviewState(state: ReviewState): Record<string, unknown> {
  return {
    name: state.proposalName,
    status: state.status,
    reviewer: state.reviewer ?? null,
    reviewedAt: state.reviewedAt ?? null,
    score: state.score ?? null,
  };
}
