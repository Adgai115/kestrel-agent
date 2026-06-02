import { describe, expect, it } from "vitest";
import { ConversationLoop, KESTREL_CORE_VERSION } from "../src/index.js";

describe("@kestrel/core", () => {
  it("exports version", () => {
    expect(KESTREL_CORE_VERSION).toBe("0.0.1");
  });

  it("ConversationLoop can be constructed", () => {
    const loop = new ConversationLoop({ apiKey: "test-key" });
    expect(loop).toBeDefined();
    expect(loop.isRunning).toBe(false);
  });
});
