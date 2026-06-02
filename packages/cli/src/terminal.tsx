/**
 * Terminal helpers — ANSI escape codes for non-React output (error messages in repl catch blocks).
 *
 * Ink components use native props (color, bold, dimColor).
 * This file provides style constants for raw console.log fallback messages.
 */

import { Text } from "ink";
import type { ReactElement } from "react";

const C = "\x1b[";

export const style = {
  reset: `${C}0m`,
  bold: `${C}1m`,
  dim: `${C}2m`,
  cyan: `${C}36m`,
  green: `${C}32m`,
  yellow: `${C}33m`,
  white: `${C}37m`,
  gray: `${C}90m`,
  red: `${C}31m`,
};

const MAX_DIFF_BYTES = 12_000;

/** Struct describing one formatted diff line ready for Ink rendering. */
export interface DiffLine {
  prefix: string;
  text: string;
  color?: "green" | "red" | "cyan" | "dim";
}

/**
 * Parse unified diff text into color-tagged lines.
 * Returns null if the text doesn't look like a diff.
 */
export function parseDiff(text: string): DiffLine[] | null {
  const truncated = text.slice(0, MAX_DIFF_BYTES);
  const hasDiffMarkers = /^[+@-]/.test(truncated) && /^[-]{3} /m.test(truncated) && /^[+]{3} /m.test(truncated);
  if (!hasDiffMarkers && !truncated.startsWith("diff --git")) return null;

  const lines: DiffLine[] = [];
  for (const raw of truncated.split("\n")) {
    const line = raw.length > 200 ? `${raw.slice(0, 197)}...` : raw;
    if (line.startsWith("+++ ") || line.startsWith("--- ")) {
      lines.push({ prefix: "", text: line, color: "cyan" });
    } else if (line.startsWith("+") && !line.startsWith("+++ ")) {
      lines.push({ prefix: "+", text: line.slice(1), color: "green" });
    } else if (line.startsWith("-") && !line.startsWith("--- ")) {
      lines.push({ prefix: "-", text: line.slice(1), color: "red" });
    } else if (line.startsWith("@@")) {
      lines.push({ prefix: "", text: line, color: "cyan" });
    } else if (
      line.startsWith("diff --git") ||
      line.startsWith("index ") ||
      line.startsWith("---") ||
      line.startsWith("+++")
    ) {
      lines.push({ prefix: "", text: line, color: "dim" });
    } else {
      lines.push({ prefix: "", text: line, color: "dim" });
    }
  }
  return lines.length > 0 ? lines : null;
}

/**
 * Render diff lines as Ink Text elements.
 * Keys are line-indexed for stable reconciliation.
 */
export function renderDiffLines(lines: DiffLine[]): ReactElement {
  const elements: ReactElement[] = [];
  for (const dl of lines) {
    const content = `${dl.text}\n`;
    if (dl.color === "green") {
      elements.push(<Text color="green">{content}</Text>);
    } else if (dl.color === "red") {
      elements.push(<Text color="red">{content}</Text>);
    } else if (dl.color === "cyan") {
      elements.push(<Text color="cyan">{content}</Text>);
    } else {
      elements.push(<Text dimColor>{content}</Text>);
    }
  }
  return <Text>{elements}</Text>;
}
