#!/usr/bin/env node
// Kestrel global CLI — npm link entry point
// Finds project root and runs CLI via tsx

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

function findRoot(start) {
  let dir = resolve(start);
  while (true) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break; // hit filesystem root
    dir = parent;
  }
  return start;
}

const root = findRoot(__dirname);
const cliEntry = join(root, "packages", "cli", "bin", "kestrel.js");

if (!existsSync(cliEntry)) {
  console.error("Kestrel CLI not found at:", cliEntry);
  console.error("Run: pnpm build");
  process.exit(1);
}

const child = spawn("npx", ["tsx", cliEntry, ...process.argv.slice(2)], {
  cwd: process.cwd(),
  stdio: "inherit",
  shell: true,
});

child.on("exit", (code) => process.exit(code ?? 1));
