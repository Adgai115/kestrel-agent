/**
 * KCP-0702: Scorer + secret-risk evaluator.
 *
 * Scores memory proposals, learning patterns, and audit findings
 * for risk, quality, and relevance. Used by the self-improving loop.
 */

import { containsSecrets } from "./secret-detector.js";

/** Score result with detailed breakdown. */
export interface ProposalScore {
  total: number;
  relevance: number;
  freshness: number;
  risk: number;
  isSecret: boolean;
  recommendation: "auto-accept" | "review" | "reject";
}

const DEFAULT_THRESHOLDS = {
  autoAccept: 85,
  review: 50,
};

/**
 * Score a memory proposal based on content, source, and context.
 */
export function scoreProposal(params: {
  content: string;
  source: "conversation" | "audit" | "pattern";
  frequency?: number;
  recency?: number;
}): ProposalScore {
  const { content, source, frequency = 1, recency = 1 } = params;

  // Risk: detect secrets, high-risk patterns
  const isSecret = containsSecrets(content);
  const risk = isSecret ? 100 : source === "audit" ? 30 : 10;

  // Relevance: based on content length and source quality
  const relevance = Math.min(100, content.length > 50 ? 70 : 40 + (source === "pattern" ? 20 : 0));

  // Freshness: based on recency and frequency
  const freshness = Math.min(100, 30 + recency * 20 + Math.min(frequency, 3) * 10);

  // Total weighted score
  const total = Math.round(relevance * 0.5 + freshness * 0.3 - risk * 0.2);

  let recommendation: ProposalScore["recommendation"];
  if (isSecret || total < DEFAULT_THRESHOLDS.review) recommendation = "reject";
  else if (total >= DEFAULT_THRESHOLDS.autoAccept) recommendation = "auto-accept";
  else recommendation = "review";

  return { total: Math.max(0, total), relevance, freshness, risk, isSecret, recommendation };
}

/**
 * Evaluate secret risk level for audit/review.
 */
export function evaluateSecretRisk(text: string): { hasSecrets: boolean; riskLevel: "low" | "medium" | "high" } {
  if (containsSecrets(text)) return { hasSecrets: true, riskLevel: "high" };
  const sensitiveTerms = [/password/i, /token/i, /secret/i, /credential/i, /\.env/i];
  const matchCount = sensitiveTerms.filter((p) => p.test(text)).length;
  if (matchCount >= 3) return { hasSecrets: false, riskLevel: "high" };
  if (matchCount >= 1) return { hasSecrets: false, riskLevel: "medium" };
  return { hasSecrets: false, riskLevel: "low" };
}
