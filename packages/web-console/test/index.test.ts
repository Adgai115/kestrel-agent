import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ConsoleApi, KESTREL_WEB_CONSOLE_VERSION } from "../src/index.js";

describe("@kestrel/web-console", () => {
  it("exports version", () => {
    expect(KESTREL_WEB_CONSOLE_VERSION).toBe("0.1.0");
  });
});

// TASK-0072: ConsoleApi integration tests
describe("ConsoleApi", () => {
  let gw: any;
  let api: ConsoleApi;

  beforeAll(async () => {
    const { KestrelGateway } = await import("@kestrel/gateway");
    gw = new KestrelGateway({ port: 0, token: "console-test-token" });
    await gw.start();
    const port = gw.server.server.address()?.port;
    api = new ConsoleApi({ gatewayUrl: `http://127.0.0.1:${port}`, token: "console-test-token" });
  });

  afterAll(async () => {
    if (gw) await gw.stop();
  });

  it("health() returns status ok", async () => {
    const result = await api.health();
    expect(result).toMatchObject({ status: "ok" });
  });

  it("status() returns session info", async () => {
    const result = await api.status();
    expect(result).toHaveProperty("status", "ok");
    expect(result).toHaveProperty("sessions");
  });
});
