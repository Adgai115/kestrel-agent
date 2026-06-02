import { afterEach, describe, expect, it } from "vitest";
import { KESTREL_GATEWAY_VERSION, KestrelGateway } from "../src/index.js";

describe("@kestrel/gateway", () => {
  let gw: KestrelGateway;
  const token = "test-token-12345";

  afterEach(async () => {
    if (gw) {
      try {
        await gw.stop();
      } catch {
        /* server may not be started */
      }
    }
  });

  it("exports version", () => {
    expect(KESTREL_GATEWAY_VERSION).toBe("0.0.1");
  });

  it("starts and responds to health check without auth", async () => {
    gw = new KestrelGateway({ port: 0, token });
    await gw.start();
    const port = (gw.server.server.address() as any)?.port;
    expect(port).toBeGreaterThan(0);

    const res = await fetch(`http://127.0.0.1:${port}/health`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(body.version).toBe("0.0.1");
  });

  it("rejects status without auth token", async () => {
    gw = new KestrelGateway({ port: 0, token });
    await gw.start();
    const port = (gw.server.server.address() as any)?.port;

    const res = await fetch(`http://127.0.0.1:${port}/status`);
    expect(res.status).toBe(401);
  });

  it("accepts status with valid auth token", async () => {
    gw = new KestrelGateway({ port: 0, token });
    await gw.start();
    const port = (gw.server.server.address() as any)?.port;

    const res = await fetch(`http://127.0.0.1:${port}/status`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(body.tokenPrefix).toBeDefined();
  });

  it("handles JSON-RPC ping", async () => {
    gw = new KestrelGateway({ port: 0, token });
    await gw.start();
    const port = (gw.server.server.address() as any)?.port;

    const res = await fetch(`http://127.0.0.1:${port}/rpc`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ id: "1", method: "ping" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.result).toBe("pong");
  });

  it("returns error for unknown RPC method", async () => {
    gw = new KestrelGateway({ port: 0, token });
    await gw.start();
    const port = (gw.server.server.address() as any)?.port;

    const res = await fetch(`http://127.0.0.1:${port}/rpc`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ id: "1", method: "unknown_method" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.error).toBeDefined();
    expect(body.error.code).toBe(-32601);
  });

  it("generates a token if none provided", async () => {
    gw = new KestrelGateway({ port: 0 });
    await gw.start();
    const port = (gw.server.server.address() as any)?.port;

    // Without token, unauthorized
    const noAuth = await fetch(`http://127.0.0.1:${port}/status`);
    expect(noAuth.status).toBe(401);

    // With generated token, authorized
    const withAuth = await fetch(`http://127.0.0.1:${port}/status`, {
      headers: { Authorization: `Bearer ${gw.config.token}` },
    });
    expect(withAuth.status).toBe(200);
  });

  it("binds only to localhost by default", async () => {
    const gw2 = new KestrelGateway({ port: 0, token: "test" });
    try {
      await gw2.start();
      const addr = gw2.server.server.address();
      if (addr && typeof addr === "object") {
        expect(addr.address).toBe("127.0.0.1");
      }
    } finally {
      try {
        await gw2.stop();
      } catch {
        /* */
      }
    }
  });

  // AUDIT-006-005: SSE and WebSocket auth tests
  describe("SSE", () => {
    it("rejects SSE without auth", async () => {
      gw = new KestrelGateway({ port: 0, token });
      await gw.start();
      const port = (gw.server.server.address() as any)?.port;

      const res = await fetch(`http://127.0.0.1:${port}/sse`);
      expect(res.status).toBe(401);
    });

    it("accepts SSE with valid auth", async () => {
      gw = new KestrelGateway({ port: 0, token });
      await gw.start();
      const port = (gw.server.server.address() as any)?.port;

      const controller = new AbortController();
      const res = await fetch(`http://127.0.0.1:${port}/sse`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: controller.signal,
      });
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/event-stream");
      // Abort the long-lived stream so afterEach can stop the server
      controller.abort();
    });
  });

  describe("WebSocket", () => {
    it("rejects WebSocket without auth", async () => {
      gw = new KestrelGateway({ port: 0, token });
      await gw.start();
      const port = (gw.server.server.address() as any)?.port;

      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
      const result = await new Promise<string>((resolve) => {
        ws.onclose = (ev) => resolve(`close:${ev.code}`);
        ws.onerror = () => resolve("error");
        setTimeout(() => resolve("timeout"), 2000);
      });
      expect(result).toMatch(/close:4001|error/);
    });

    it("accepts WebSocket with valid auth", async () => {
      gw = new KestrelGateway({ port: 0, token });
      await gw.start();
      const port = (gw.server.server.address() as any)?.port;

      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const result = await new Promise<string>((resolve) => {
        ws.onmessage = (ev) => resolve(ev.data);
        ws.onerror = () => resolve("error");
        setTimeout(() => resolve("timeout"), 3000);
      });
      const msg = JSON.parse(result);
      expect(msg.type).toBe("connected");
      ws.close();
    });

    it("handles malformed JSON gracefully", async () => {
      gw = new KestrelGateway({ port: 0, token });
      await gw.start();
      const port = (gw.server.server.address() as any)?.port;

      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const result = await new Promise<string>((resolve) => {
        let connected = false;
        ws.onmessage = (ev) => {
          const msg = JSON.parse(ev.data as string);
          if (!connected && msg.type === "connected") {
            connected = true;
            ws.send("not-json{{{");
            return;
          }
          resolve(ev.data as string);
        };
        setTimeout(() => resolve("timeout"), 3000);
      });
      const msg = JSON.parse(result);
      expect(msg.type).toBe("error");
      expect(msg.message).toContain("Invalid JSON");
      ws.close();
    });
  });

  describe("Rate limiting", () => {
    it("returns 429 when rate limit exceeded", async () => {
      gw = new KestrelGateway({
        port: 0,
        token,
        rateLimit: { max: 3, timeWindow: 60_000 },
      });
      await gw.start();
      const port = (gw.server.server.address() as any)?.port;
      const headers = { Authorization: `Bearer ${token}` };

      for (let i = 0; i < 3; i++) {
        const res = await fetch(`http://127.0.0.1:${port}/status`, { headers });
        expect(res.status).toBe(200);
      }

      const res = await fetch(`http://127.0.0.1:${port}/status`, { headers });
      expect(res.status).toBe(429);
    });

    it("health endpoint is exempt from rate limiting", async () => {
      gw = new KestrelGateway({
        port: 0,
        token,
        rateLimit: { max: 2, timeWindow: 60_000 },
      });
      await gw.start();
      const port = (gw.server.server.address() as any)?.port;

      for (let i = 0; i < 2; i++) {
        await fetch(`http://127.0.0.1:${port}/status`, {
          headers: { Authorization: `Bearer ${token}` },
        });
      }

      const res = await fetch(`http://127.0.0.1:${port}/health`);
      expect(res.status).toBe(200);
    });

    it("rate limit can be disabled", async () => {
      gw = new KestrelGateway({ port: 0, token, rateLimit: false });
      await gw.start();
      const port = (gw.server.server.address() as any)?.port;
      const headers = { Authorization: `Bearer ${token}` };

      for (let i = 0; i < 10; i++) {
        const res = await fetch(`http://127.0.0.1:${port}/status`, { headers });
        expect(res.status).toBe(200);
      }
    });

    it("default rate limit allows normal usage", async () => {
      gw = new KestrelGateway({ port: 0, token });
      await gw.start();
      const port = (gw.server.server.address() as any)?.port;
      const headers = { Authorization: `Bearer ${token}` };

      for (let i = 0; i < 5; i++) {
        const res = await fetch(`http://127.0.0.1:${port}/status`, { headers });
        expect(res.status).toBe(200);
      }
    });
  });

  describe("RPC chat", () => {
    it("returns chat response via onChat handler", async () => {
      gw = new KestrelGateway({
        port: 0,
        token,
        onChat: async (prompt) => `Echo: ${prompt}`,
      });
      await gw.start();
      const port = (gw.server.server.address() as any)?.port;

      const res = await fetch(`http://127.0.0.1:${port}/rpc`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ id: "1", method: "chat", params: { prompt: "Hello" } }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.result.response).toBe("Echo: Hello");
    });

    it("returns fallback when onChat not configured", async () => {
      gw = new KestrelGateway({ port: 0, token });
      await gw.start();
      const port = (gw.server.server.address() as any)?.port;

      const res = await fetch(`http://127.0.0.1:${port}/rpc`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ id: "1", method: "chat", params: { prompt: "Hi" } }),
      });
      const body = await res.json();
      expect(body.result.response).toContain("not configured");
    });

    it("returns error when prompt is missing", async () => {
      gw = new KestrelGateway({ port: 0, token, onChat: async () => "" });
      await gw.start();
      const port = (gw.server.server.address() as any)?.port;

      const res = await fetch(`http://127.0.0.1:${port}/rpc`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ id: "1", method: "chat", params: {} }),
      });
      const body = await res.json();
      expect(body.error).toBeDefined();
      expect(body.error.code).toBe(-32602);
    });
  });
});
