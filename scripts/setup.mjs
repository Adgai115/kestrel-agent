// Kestrel Agent setup — installs git hooks, validates environment
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

// Install pre-commit hook
const hookSrc = resolve(root, "scripts", "pre-commit.ps1");
const hookDir = resolve(root, ".git", "hooks");
const hookPs1 = resolve(hookDir, "pre-commit.ps1");
const hookSh = resolve(hookDir, "pre-commit");

if (existsSync(hookSrc)) {
  mkdirSync(hookDir, { recursive: true });
  copyFileSync(hookSrc, hookPs1);

  // Create shell wrapper for git on Windows
  const wrapper = '#!/bin/sh\nexec pwsh.exe -NoProfile -NonInteractive -File ".git/hooks/pre-commit.ps1"\n';
  const { writeFileSync } = await import("node:fs");
  writeFileSync(hookSh, wrapper, "utf-8");

  console.log("[setup] pre-commit hook installed");
} else {
  console.log("[setup] pre-commit script not found, skipping hook install");
}

console.log("[setup] done");
