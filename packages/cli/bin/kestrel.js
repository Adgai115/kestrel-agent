#!/usr/bin/env node
import { repl, main } from "../src/index.ts";

const args = process.argv.slice(2);

if (args.length === 0 || args[0] === "chat") {
  if (!process.stdout.isTTY) {
    console.error("kestrel chat requires a terminal (TTY). Use 'kestrel help' for non-TTY commands.");
    process.exitCode = 1;
  } else {
    repl().catch((err) => {
      console.error(err.message);
      process.exitCode = 1;
    });
  }
} else {
  const result = await main(process.argv);
  if (result.output) console.log(result.output);
  process.exitCode = result.code;
}
