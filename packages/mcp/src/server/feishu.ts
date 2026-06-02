#!/usr/bin/env node
/**
 * TASK-1135: Built-in Feishu MCP server — stdio transport.
 *
 * Exposes Feishu channel tools via MCP protocol so the CLI can use them
 * without an external MCP server process.
 *
 * Usage: node --import tsx packages/mcp/src/server/feishu.ts
 *   or set KESTREL_MCP_COMMAND=node KESTREL_MCP_ARGS=--import,tsx,packages/mcp/src/server/feishu.ts
 */

import { Buffer } from "node:buffer";

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number | string;
  method: string;
  params?: Record<string, unknown>;
}

interface McpToolDef {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}

const TOOLS: McpToolDef[] = [
  {
    name: "feishu_send_message",
    description: "向飞书用户或群聊发送文本消息",
    inputSchema: {
      type: "object",
      properties: {
        receive_id: { type: "string", description: "接收者 open_id 或 chat_id" },
        receive_id_type: { type: "string", enum: ["open_id", "chat_id"], description: "接收者类型" },
        msg_type: { type: "string", enum: ["text", "interactive"], description: "消息类型，默认 text" },
        text: { type: "string", description: "消息文本内容" },
      },
      required: ["receive_id", "text"],
    },
  },
  {
    name: "feishu_get_user_info",
    description: "获取飞书用户信息",
    inputSchema: {
      type: "object",
      properties: {
        open_id: { type: "string", description: "用户 open_id" },
      },
      required: ["open_id"],
    },
  },
  {
    name: "feishu_list_channels",
    description: "列出已配置的飞书通道状态",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
];

function writeResponse(id: number | string, result: unknown) {
  const resp = JSON.stringify({ jsonrpc: "2.0", id, result });
  const len = Buffer.byteLength(resp);
  process.stdout.write(`Content-Length: ${len}\r\n\r\n${resp}`);
}

function writeError(id: number | string | undefined, code: number, message: string) {
  const resp = JSON.stringify({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });
  const len = Buffer.byteLength(resp);
  process.stdout.write(`Content-Length: ${len}\r\n\r\n${resp}`);
}

async function handleToolCall(name: string, args: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case "feishu_send_message": {
      const appId = process.env.FEISHU_APP_ID ?? "";
      const appSecret = process.env.FEISHU_APP_SECRET ?? "";
      if (!appId || !appSecret) {
        return {
          content: [
            { type: "text", text: "Feishu credentials not configured. Set FEISHU_APP_ID and FEISHU_APP_SECRET." },
          ],
          isError: true,
        };
      }
      // Get tenant token
      const tokenRes = await fetch("https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
      });
      const tokenJson = (await tokenRes.json()) as { tenant_access_token?: string; msg?: string };
      if (!tokenJson.tenant_access_token) {
        return {
          content: [{ type: "text", text: `Feishu auth failed: ${tokenJson.msg ?? "unknown"}` }],
          isError: true,
        };
      }
      const token = tokenJson.tenant_access_token;
      const receiveId = String(args.receive_id ?? "");
      const receiveIdType = String(args.receive_id_type ?? "open_id");
      const msgType = String(args.msg_type ?? "text");
      const text = String(args.text ?? "");
      const content = msgType === "interactive" ? JSON.stringify(args.content ?? {}) : JSON.stringify({ text });
      const sendRes = await fetch(`https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=${receiveIdType}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ receive_id: receiveId, msg_type: msgType, content }),
      });
      const sendJson = (await sendRes.json()) as { code?: number; msg?: string; data?: unknown };
      if (sendJson.code !== 0) {
        return { content: [{ type: "text", text: `Send failed: ${sendJson.msg ?? "unknown"}` }], isError: true };
      }
      return { content: [{ type: "text", text: `Message sent to ${receiveId}` }] };
    }
    case "feishu_get_user_info": {
      const appId = process.env.FEISHU_APP_ID ?? "";
      const appSecret = process.env.FEISHU_APP_SECRET ?? "";
      if (!appId || !appSecret) {
        return { content: [{ type: "text", text: "Feishu credentials not configured." }], isError: true };
      }
      const tokenRes = await fetch("https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
      });
      const tokenJson = (await tokenRes.json()) as { tenant_access_token?: string };
      if (!tokenJson.tenant_access_token) {
        return { content: [{ type: "text", text: "Auth failed" }], isError: true };
      }
      const openId = String(args.open_id ?? "");
      const userRes = await fetch(`https://open.feishu.cn/open-apis/contact/v3/users/${openId}`, {
        headers: { Authorization: `Bearer ${tokenJson.tenant_access_token}` },
      });
      const userJson = (await userRes.json()) as { data?: { user?: unknown } };
      return { content: [{ type: "text", text: JSON.stringify(userJson.data?.user ?? userJson, null, 2) }] };
    }
    case "feishu_list_channels": {
      const info = {
        feishu: {
          configured: !!(process.env.FEISHU_APP_ID && process.env.FEISHU_APP_SECRET),
          appId: process.env.FEISHU_APP_ID ? `${process.env.FEISHU_APP_ID.slice(0, 8)}...` : "not set",
        },
      };
      return { content: [{ type: "text", text: JSON.stringify(info, null, 2) }] };
    }
    default:
      return { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true };
  }
}

function main(): void {
  let buf = "";
  process.stdin.setEncoding("utf-8");

  process.stdin.on("data", (chunk: string) => {
    buf += chunk;
    const headerRe = /Content-Length:\s*(\d+)\r?\n\r?\n/;
    let m = headerRe.exec(buf);
    while (m) {
      const len = Number.parseInt(m[1]!, 10);
      const hEnd = m.index + m[0].length;
      if (buf.length - hEnd < len) break;
      const body = buf.slice(hEnd, hEnd + len);
      buf = buf.slice(hEnd + len);
      try {
        const req = JSON.parse(body) as JsonRpcRequest;
        if (req.method === "initialize") {
          writeResponse(req.id, {
            protocolVersion: "2024-11-05",
            serverInfo: { name: "feishu", version: "0.1.0" },
            capabilities: { tools: {} },
          });
        } else if (req.method === "notifications/initialized") {
          // no response needed
        } else if (req.method === "tools/list") {
          writeResponse(req.id, { tools: TOOLS });
        } else if (req.method === "tools/call") {
          const params = req.params as { name?: string; arguments?: Record<string, unknown> };
          handleToolCall(params.name ?? "", params.arguments ?? {})
            .then((result) => writeResponse(req.id, result))
            .catch((e: unknown) => writeError(req.id, -32000, (e as Error).message));
        } else {
          writeError(req.id, -32601, `Method not found: ${req.method}`);
        }
      } catch {
        writeError(undefined, -32700, "Parse error");
      }
      m = headerRe.exec(buf);
    }
  });

  // Keep alive for 10 minutes
  setTimeout(() => {}, 600_000);
}

main();
