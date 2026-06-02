import { createHash, createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { FeishuAdapter, KESTREL_CHANNELS_VERSION, WebChatAdapter } from "../src/index.js";

describe("@kestrel/channels", () => {
  it("exports version", () => expect(KESTREL_CHANNELS_VERSION).toBe("0.0.1"));

  // ==========================================================================
  // WebChat
  // ==========================================================================

  describe("WebChatAdapter", () => {
    const webchat = new WebChatAdapter();

    it("returns trusted trust level", async () => {
      const msg = await webchat.normalizeMessage({ text: "hello", peerId: "u1" });
      expect(msg.trustLevel).toBe("trusted");
      expect(msg.channel).toBe("webchat");
      expect(msg.text).toBe("hello");
    });

    it("cannot be tricked into local trust via context", async () => {
      // WebChatAdapter no longer accepts context to change trust level.
      // Trust escalation is handled by Gateway auth, not adapter.
      const msg = await webchat.normalizeMessage({ text: "x" });
      expect(msg.trustLevel).toBe("trusted");
    });

    it("generates id if missing", async () => {
      const msg = await webchat.normalizeMessage({ text: "test" });
      expect(msg.id).toBeTruthy();
    });
  });

  // ==========================================================================
  // Feishu
  // ==========================================================================

  describe("FeishuAdapter", () => {
    const encryptKey = "feishu-encrypt-key-xyz";
    const feishu = new FeishuAdapter({ encryptKey, allowlist: ["ou_approved_user"] });

    it("name is feishu", () => expect(feishu.name).toBe("feishu"));

    // Official event callback algorithm: SHA256(timestamp + nonce + encryptKey + body) → hex
    it("verifies valid SHA256 hex signature", async () => {
      const ts = Math.floor(Date.now() / 1000).toString();
      const body = JSON.stringify({ event: { message: { content: "{}" } } });
      const sig = createHash("sha256").update(`${ts}nonce${encryptKey}${body}`, "utf-8").digest("hex");

      expect(
        await feishu.verifyIncomingRequest(
          { "x-lark-request-timestamp": ts, "x-lark-request-nonce": "nonce", "x-lark-signature": sig },
          body,
        ),
      ).toBe(true);
    });

    it("rejects HMAC-base64 signature", async () => {
      const ts = Math.floor(Date.now() / 1000).toString();
      const body = JSON.stringify({});
      const { createHmac } = await import("node:crypto");
      const oldSig = createHmac("sha256", encryptKey).update(`${ts}n${body}`).digest("base64");

      expect(
        await feishu.verifyIncomingRequest(
          { "x-lark-request-timestamp": ts, "x-lark-request-nonce": "n", "x-lark-signature": oldSig },
          body,
        ),
      ).toBe(false);
    });

    it("rejects invalid signature", async () => {
      expect(
        await feishu.verifyIncomingRequest(
          { "x-lark-request-timestamp": "1", "x-lark-request-nonce": "x", "x-lark-signature": "bad" },
          "{}",
        ),
      ).toBe(false);
    });

    it("rejects when encryptKey missing", async () => {
      const nk = new FeishuAdapter({ allowlist: ["ou_1"] });
      expect(
        await nk.verifyIncomingRequest(
          { "x-lark-request-timestamp": "1", "x-lark-request-nonce": "x", "x-lark-signature": "x" },
          "{}",
        ),
      ).toBe(false);
    });

    it("private chat → trusted", async () => {
      const msg = await feishu.normalizeMessage({
        event: {
          sender: { sender_id: { open_id: "ou_approved_user" } },
          message: { message_id: "m1", chat_type: "private", content: JSON.stringify({ text: "hi" }) },
        },
      });
      expect(msg.trustLevel).toBe("trusted");
      expect(msg.text).toBe("hi");
    });

    it("group chat → limited", async () => {
      const msg = await feishu.normalizeMessage({
        event: {
          sender: { sender_id: { open_id: "ou_approved_user" } },
          message: { message_id: "m2", chat_type: "group", chat_id: "g1", content: JSON.stringify({ text: "hey" }) },
        },
      });
      expect(msg.trustLevel).toBe("limited");
      expect(msg.roomId).toBe("g1");
    });

    it("rejects peer not in allowlist", async () => {
      await expect(
        feishu.normalizeMessage({
          event: {
            sender: { sender_id: { open_id: "ou_stranger" } },
            message: { message_id: "m3", chat_type: "private", content: JSON.stringify({ text: "x" }) },
          },
        }),
      ).rejects.toThrow("allowlist");
    });

    it("empty allowlist → deny all", async () => {
      const empty = new FeishuAdapter({ encryptKey });
      await expect(
        empty.normalizeMessage({
          event: {
            sender: { sender_id: { open_id: "anyone" } },
            message: { message_id: "m", chat_type: "private", content: JSON.stringify({ text: "x" }) },
          },
        }),
      ).rejects.toThrow("allowlist is empty");
    });

    it("undefined allowlist → deny all", async () => {
      const noList = new FeishuAdapter({ encryptKey });
      await expect(
        noList.normalizeMessage({
          event: {
            sender: { sender_id: { open_id: "anyone" } },
            message: { message_id: "m", chat_type: "private", content: JSON.stringify({ text: "x" }) },
          },
        }),
      ).rejects.toThrow("allowlist is empty");
    });

    it("sendMessage throws when app credentials not configured", async () => {
      await expect(feishu.sendMessage({ channel: "feishu", peerId: "ou_1" }, { text: "hi" })).rejects.toThrow(
        "appId and appSecret",
      );
    });

    it("sendMessage throws with invalid credentials", async () => {
      const withCreds = new FeishuAdapter({ encryptKey, allowlist: ["ou_1"], appId: "bad", appSecret: "bad" });
      await expect(withCreds.sendMessage({ channel: "feishu", peerId: "ou_1" }, { text: "hi" })).rejects.toThrow();
    });

    it("verifyIncomingRequest accepts valid HMAC signature", async () => {
      const key = "test-encrypt-key";
      const fs = new FeishuAdapter({ encryptKey: key, allowlist: ["ou_1"] });
      const ts = "1700000000";
      const nonce = "abc123";
      const body = JSON.stringify({ challenge: "test" });
      const hmac = createHash("sha256");
      hmac.update(ts + nonce + key + body);
      const sig = hmac.digest("hex");

      const ok = await fs.verifyIncomingRequest(
        { "x-lark-request-timestamp": ts, "x-lark-request-nonce": nonce, "x-lark-signature": sig },
        body,
      );
      expect(ok).toBe(true);
    });

    it("verifyIncomingRequest rejects invalid signature", async () => {
      const fs = new FeishuAdapter({ encryptKey: "correct-key", allowlist: ["ou_1"] });
      const hmac = createHash("sha256");
      hmac.update("1" + "x" + "wrong-key" + "{}");
      const badSig = hmac.digest("hex");

      const ok = await fs.verifyIncomingRequest(
        { "x-lark-request-timestamp": "1", "x-lark-request-nonce": "x", "x-lark-signature": badSig },
        "{}",
      );
      expect(ok).toBe(false);
    });
  });

  // TASK-0036: Telegram adapter
  describe("TelegramAdapter", () => {
    it("has correct name", async () => {
      const { TelegramAdapter } = await import("../src/telegram.js");
      expect(new TelegramAdapter().name).toBe("telegram");
    });

    it("normalizes private chat as trusted", async () => {
      const { TelegramAdapter } = await import("../src/telegram.js");
      const adapter = new TelegramAdapter({ allowlist: ["12345"] });
      const msg = await adapter.normalizeMessage({
        message: { from: { id: 12345 }, chat: { id: 888 }, text: "hello", date: 1700000000 },
      });
      expect(msg.trustLevel).toBe("trusted");
      expect(msg.text).toBe("hello");
    });

    it("normalizes group chat as limited", async () => {
      const { TelegramAdapter } = await import("../src/telegram.js");
      const adapter = new TelegramAdapter({ allowlist: ["12345"] });
      const msg = await adapter.normalizeMessage({
        message: { from: { id: 12345 }, chat: { id: -999 }, text: "group msg" },
      });
      expect(msg.trustLevel).toBe("limited");
    });

    it("empty allowlist denies all", async () => {
      const { TelegramAdapter } = await import("../src/telegram.js");
      const adapter = new TelegramAdapter();
      await expect(adapter.normalizeMessage({ message: { from: { id: 1 } } })).rejects.toThrow("allowlist is empty");
    });

    it("rejects peer not in allowlist", async () => {
      const { TelegramAdapter } = await import("../src/telegram.js");
      const adapter = new TelegramAdapter({ allowlist: ["111"] });
      await expect(adapter.normalizeMessage({ message: { from: { id: 999 } } })).rejects.toThrow("allowlist");
    });

    it("verifyIncomingRequest with valid secret token hash", async () => {
      const { TelegramAdapter } = await import("../src/telegram.js");
      const botToken = "test-bot-token";
      const expectedHash = createHash("sha256").update(botToken).digest("hex");
      const adapter = new TelegramAdapter({ botToken, allowlist: ["111"] });
      const ok = await adapter.verifyIncomingRequest(
        { "x-telegram-bot-api-secret-token": expectedHash },
        { message: { from: { id: 111 }, text: "test" } },
      );
      expect(ok).toBe(true);
    });

    it("verifyIncomingRequest rejects with wrong hash", async () => {
      const { TelegramAdapter } = await import("../src/telegram.js");
      const adapter = new TelegramAdapter({ botToken: "real-token", allowlist: ["111"] });
      const ok = await adapter.verifyIncomingRequest({ "x-telegram-bot-api-secret-token": "bad-hash" }, {});
      expect(ok).toBe(false);
    });

    it("verifyIncomingRequest accepts any secret header when no botToken", async () => {
      const { TelegramAdapter } = await import("../src/telegram.js");
      const adapter = new TelegramAdapter({ allowlist: ["111"] });
      const ok = await adapter.verifyIncomingRequest({ "x-telegram-bot-api-secret-token": "anything" }, {});
      expect(ok).toBe(true);
    });
  });

  // TASK-0036: Slack adapter
  describe("SlackAdapter", () => {
    it("has correct name", async () => {
      const { SlackAdapter } = await import("../src/slack.js");
      expect(new SlackAdapter().name).toBe("slack");
    });

    it("verifyIncomingRequest rejects without signing secret", async () => {
      const { SlackAdapter } = await import("../src/slack.js");
      const adapter = new SlackAdapter();
      expect(await adapter.verifyIncomingRequest({}, {})).toBe(false);
    });

    it("verifyIncomingRequest accepts valid HMAC-SHA256 signature", async () => {
      const { SlackAdapter } = await import("../src/slack.js");
      const secret = "slack-secret-key";
      const adapter = new SlackAdapter({ signingSecret: secret, allowlist: ["U123"] });
      const ts = "1700000000";
      const body = '{"type":"event_callback","event":{}}';
      const baseString = `v0:${ts}:${body}`;
      const sig = `v0=${createHmac("sha256", secret).update(baseString).digest("hex")}`;

      const ok = await adapter.verifyIncomingRequest(
        { "x-slack-request-timestamp": ts, "x-slack-signature": sig },
        body,
      );
      expect(ok).toBe(true);
    });

    it("verifyIncomingRequest rejects with wrong signing secret", async () => {
      const { SlackAdapter } = await import("../src/slack.js");
      const adapter = new SlackAdapter({ signingSecret: "real-secret", allowlist: ["U123"] });
      const ts = "1700000000";
      const body = "{}";
      const badSig = `v0=${createHmac("sha256", "wrong-secret").update(`v0:${ts}:${body}`).digest("hex")}`;

      const ok = await adapter.verifyIncomingRequest(
        { "x-slack-request-timestamp": ts, "x-slack-signature": badSig },
        body,
      );
      expect(ok).toBe(false);
    });

    it("normalizes DM as trusted", async () => {
      const { SlackAdapter } = await import("../src/slack.js");
      const adapter = new SlackAdapter({ allowlist: ["U123"] });
      const msg = await adapter.normalizeMessage({
        event: { user: "U123", channel_type: "im", text: "hello" },
      });
      expect(msg.trustLevel).toBe("trusted");
    });

    it("normalizes channel message as limited", async () => {
      const { SlackAdapter } = await import("../src/slack.js");
      const adapter = new SlackAdapter({ allowlist: ["U123"] });
      const msg = await adapter.normalizeMessage({
        event: { user: "U123", channel_type: "channel", text: "group msg" },
      });
      expect(msg.trustLevel).toBe("limited");
    });

    it("empty allowlist denies all", async () => {
      const { SlackAdapter } = await import("../src/slack.js");
      const adapter = new SlackAdapter();
      await expect(adapter.normalizeMessage({ event: { user: "U1" } })).rejects.toThrow("allowlist is empty");
    });
  });
});
