/**
 * KCP-0703: Workflow pattern detector — auto-propose skills from repeated tool calls.
 *
 * Tracks sequences of tool invocations and detects patterns
 * that repeat across sessions. Repeated workflows are proposed
 * as skills for the user to review.
 */

export interface ToolCallRecord {
  tool: string;
  args: Record<string, unknown>;
  timestamp: number;
}

export interface WorkflowPattern {
  /** Sequence of tool names that form the pattern */
  tools: string[];
  /** Number of times this sequence has been observed */
  frequency: number;
  /** Most recent observation timestamp */
  lastSeen: number;
  /** Proposed skill name */
  proposedName: string;
}

const MIN_FREQUENCY = 3;
const MAX_TOOLS = 4;

/**
 * Detect repeated tool call sequences and return skill proposals.
 */
export function detectWorkflows(history: ToolCallRecord[]): WorkflowPattern[] {
  const patterns = new Map<string, WorkflowPattern>();
  const names = history.map((c) => c.tool);

  // Slide a window of 2-4 consecutive tools, find repeats
  for (let len = 2; len <= MAX_TOOLS && len <= names.length; len++) {
    for (let i = 0; i <= names.length - len; i++) {
      const seq = names.slice(i, i + len).join(",");
      const existing = patterns.get(seq);
      if (existing) {
        existing.frequency++;
        existing.lastSeen = Math.max(existing.lastSeen, history[i + len - 1]?.timestamp ?? 0);
      } else {
        const count = countOccurrences(names, names.slice(i, i + len));
        if (count >= MIN_FREQUENCY) {
          patterns.set(seq, {
            tools: names.slice(i, i + len),
            frequency: count,
            lastSeen: history[i + len - 1]?.timestamp ?? 0,
            proposedName: `workflow-${names.slice(i, i + len).join("-")}`,
          });
        }
      }
    }
  }

  return [...patterns.values()].sort((a, b) => b.frequency - a.frequency);
}

function countOccurrences(haystack: string[], needle: string[]): number {
  let count = 0;
  for (let i = 0; i <= haystack.length - needle.length; i++) {
    if (needle.every((t, j) => haystack[i + j] === t)) count++;
  }
  return count;
}

/**
 * Generate a human-readable proposal from a detected workflow.
 */
export function toSkillProposal(pattern: WorkflowPattern): {
  name: string;
  description: string;
  tools: string[];
  frequency: number;
} {
  return {
    name: pattern.proposedName,
    description: `Auto-detected workflow: ${pattern.tools.join(" → ")} (seen ${pattern.frequency} times)`,
    tools: pattern.tools,
    frequency: pattern.frequency,
  };
}
