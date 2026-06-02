/**
 * Shared redaction module — strips secrets, tokens, and PII from strings.
 * Used by CLI output, Gateway logs, audit events, and tool results.
 */

const REDACT_PATTERNS: Array<[RegExp, string]> = [
  // API keys (OpenAI-style, Anthropic-style)
  [/\b(sk-[a-zA-Z0-9]{20,})\b/g, "sk-***"],
  [/\b(sk-ant-[a-zA-Z0-9_-]{20,})\b/g, "sk-ant-***"],
  // JWT tokens
  [/\b(eyJ[a-zA-Z0-9_-]{20,})\b/g, "eyJ***"],
  // Google OAuth tokens
  [/\b(ya29\.[a-zA-Z0-9_-]{20,})\b/g, "ya29.***"],
  // GitHub tokens
  [/\b(ghp_[a-zA-Z0-9]{20,})\b/g, "ghp_***"],
  [/\b(github_pat_[a-zA-Z0-9_]{20,})\b/g, "github_pat_***"],
  // Generic keys in env-var style
  [/(?:api_key|apikey|secret|token|password|passwd)\s*[:=]\s*[^\s,;}\]"']{8,}/gi, "$&"],
  // Bearer tokens (keep prefix, redact value)
  [/(Bearer\s+)[^\s,;}\]"']{8,}/gi, "$1***"],
  // Email addresses (partial redact)
  [/\b([a-zA-Z0-9._%+-]+)@([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})\b/g, "***@$2"],
];

/**
 * Redact known secret patterns from a string.
 * Returns the redacted string and a count of redactions made.
 */
export function redact(input: string): { text: string; count: number } {
  let count = 0;
  let text = input;
  for (const [pattern] of REDACT_PATTERNS) {
    const matches = text.match(pattern);
    if (matches) {
      count += matches.length;
      text = text.replace(pattern, (match) => {
        // For patterns with replacement strings that contain "$&",
        // use a fixed replacement instead
        for (const [p, repl] of REDACT_PATTERNS) {
          if (p.source === pattern.source && repl !== "$&") {
            return repl;
          }
        }
        return match.length > 20 ? `${match.slice(0, 4)}***` : "***";
      });
    }
  }
  return { text, count };
}

/**
 * Check if a string contains potential secrets.
 */
export function containsSecrets(input: string): boolean {
  return REDACT_PATTERNS.some(([p]) => p.test(input));
}

/**
 * Redact secrets from an object's string values (shallow).
 */
export function redactShallow<T extends Record<string, unknown>>(obj: T): T {
  const result = { ...obj } as Record<string, unknown>;
  for (const key of Object.keys(result)) {
    const val = result[key];
    if (typeof val === "string") {
      result[key] = redact(val).text;
    }
  }
  return result as T;
}
