/**
 * TASK-1084: Lightweight Markdown → ANSI terminal renderer.
 * Handles ``` code blocks, basic tables, bold, inline code.
 */

const ANSI = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  cyan: "\x1b[36m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
};

export function mdToAnsi(md: string): string {
  let out = md;

  // Code blocks ```
  out = out.replace(/```(\w*)\n([\s\S]*?)```/g, (_m, lang, code) => {
    const header = lang ? `${ANSI.dim}// ${lang}${ANSI.reset}\n` : "";
    return `\n${header}${ANSI.cyan}${code.trimEnd()}${ANSI.reset}\n`;
  });

  // Inline code `text`
  out = out.replace(/`([^`]+)`/g, `${ANSI.cyan}$1${ANSI.reset}`);

  // Bold **text**
  out = out.replace(/\*\*(.+?)\*\*/g, `${ANSI.bold}$1${ANSI.reset}`);

  // Simple tables: | a | b | → aligned columns
  if (out.includes("|")) {
    const lines = out.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (lines[i]?.startsWith("|") && lines[i]?.endsWith("|")) {
        const cells = lines[i]!.split("|")
          .filter(Boolean)
          .map((c) => c.trim());
        lines[i] = `  ${ANSI.dim}|${ANSI.reset} ${cells.join(` ${ANSI.dim}|${ANSI.reset} `)}`;
      }
    }
    out = lines.join("\n");
  }

  // Headers # ## ###
  out = out.replace(/^### (.+)$/gm, `${ANSI.bold}$1${ANSI.reset}`);
  out = out.replace(/^## (.+)$/gm, `${ANSI.bold}${ANSI.yellow}$1${ANSI.reset}`);
  out = out.replace(/^# (.+)$/gm, `${ANSI.bold}${ANSI.blue}$1${ANSI.reset}`);

  return out;
}
