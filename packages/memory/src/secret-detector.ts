/**
 * KCP-0702: Shared secret detection for memory scorer.
 * Mirrors patterns from @kestrel/core redact module for memory-layer use.
 */

const SECRET_PATTERNS = [
  /\b(sk-[a-zA-Z0-9]{20,})\b/,
  /\b(sk-ant-[a-zA-Z0-9_-]{20,})\b/,
  /\b(eyJ[a-zA-Z0-9_-]{20,})\b/,
  /\b(ya29\.[a-zA-Z0-9_-]{20,})\b/,
  /\b(ghp_[a-zA-Z0-9]{20,})\b/,
  /\b(github_pat_[a-zA-Z0-9_]{20,})\b/,
  /(?:api_key|apikey|secret|token|password)\s*[:=]\s*['"]?\S{8,}['"]?/i,
];

export function containsSecrets(text: string): boolean {
  return SECRET_PATTERNS.some((p) => p.test(text));
}
