/**
 * Risk classifier and path protection.
 */

import type { RiskLevel, TrustLevel } from "./types.js";

const PROTECTED_PATTERNS = [
  /(^|[\\/])\.env(\.|$)/,
  /\.pem$/i,
  /\.key$/i,
  /id_rsa/,
  /id_ed25519/,
  /(^|[\\/])\.ssh[\\/]/,
  /(^|[\\/])\.aws[\\/]/,
  /(^|[\\/])\.gcp[\\/]/,
  /(^|[\\/])\.azure[\\/]/,
];

const HOST_SHELL_KEYWORDS = [
  /\brm\s+-rf\s+\//,
  /mkfs\./,
  /dd\s+if=/,
  /:\s*\(\)\s*\{/,
  />\s*\/dev\/sda/,
  /chmod\s+777\s+\//,
];

export function isProtectedPath(target?: string): boolean {
  if (!target) return false;
  const normalized = target.replace(/\\/g, "/");
  return PROTECTED_PATTERNS.some((p) => p.test(normalized));
}

export function isDangerousCommand(command?: string): boolean {
  if (!command) return false;
  return HOST_SHELL_KEYWORDS.some((p) => p.test(command));
}

/**
 * Escalate risk level based on trust and target sensitivity.
 * - Protected paths → critical
 * - Dangerous commands → critical
 * - Limited trust escalates medium→high, high→critical
 */
export function escalateRisk(baseRisk: RiskLevel, trustLevel: TrustLevel, target?: string): RiskLevel {
  if (isProtectedPath(target)) return "critical";
  if (isDangerousCommand(target)) return "critical";

  const levels: RiskLevel[] = ["low", "medium", "high", "critical"];
  let level = levels.indexOf(baseRisk);

  // Limited trust: bump risk up one level
  if (trustLevel === "limited") {
    level = Math.min(level + 1, levels.length - 1);
  }

  return levels[level]!;
}
