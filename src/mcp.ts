// The MCP protocol layer: Streamable HTTP in its simplest stateless form. One POST endpoint takes a JSON-RPC message
// (or a small batch) and answers with JSON. No sessions, no server-sent events, nothing to store between requests, so
// it scales like any other Worker route. That covers every current MCP client (Claude, ChatGPT, Cursor, VS Code, ...).
//
// You normally don't need to touch this file: add tools in tools.ts and set your server's name in SERVER_INFO.

import { callTool, TOOLS, ToolError } from "./tools";

export interface Env {
  /** Optional: override the example API's base URL (defaults to Jupiter's free public API). Add your own vars here. */
  JUPITER_API?: string;
}

/** Your server's identity, shown by MCP clients. Change these. */
const SERVER_INFO = { name: "my-mcp-server", title: "My MCP Server", version: "1.0.0" };

/** Read by the model when it connects: say what the server is for and which tool to start with. */
const INSTRUCTIONS =
  "Read-only Solana token lookups. Use search_tokens to turn a name or ticker into a mint address, then get_token_price for live US$ prices. " +
  "Nothing here can sign or send a transaction.";

/** Newest first. The server answers with the client's version when it supports it, otherwise its newest. */
const PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];

const CORS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, GET, OPTIONS",
  "access-control-allow-headers": "content-type, mcp-protocol-version, mcp-session-id, last-event-id, authorization",
  "access-control-expose-headers": "mcp-session-id",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store", ...CORS } });

class RpcError extends Error {
  constructor(public code: number, message: string) {
    super(message);
  }
}
const rpcError = (id: unknown, code: number, message: string) => ({ jsonrpc: "2.0", id, error: { code, message } });

async function dispatch(env: Env, method: string, params: any): Promise<object> {
  switch (method) {
    case "initialize": {
      const asked = String(params?.protocolVersion ?? "");
      return {
        protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions: INSTRUCTIONS,
      };
    }
    case "ping":
      return {};
    case "tools/list":
      return { tools: TOOLS };
    case "tools/call": {
      const name = String(params?.name ?? "");
      if (!TOOLS.some((t) => t.name === name)) throw new RpcError(-32602, `Unknown tool: ${name}`);
      try {
        const result = await callTool(env, name, params?.arguments ?? {});
        // Text for clients that only read text, structuredContent for clients that validate the output schema.
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], structuredContent: result };
      } catch (err) {
        // A tool that can't answer returns a normal result with isError and a sentence the model can act on.
        // The model reads it, fixes its call and tries again. A protocol error would make it give up.
        if (err instanceof ToolError) return { content: [{ type: "text", text: err.message }], isError: true };
        console.error("tool failed", name, err);
        return { content: [{ type: "text", text: "The upstream service didn't answer. Try again in a minute." }], isError: true };
      }
    }
    // Answer the listing calls some clients make even when the server has none.
    case "resources/list":
      return { resources: [] };
    case "prompts/list":
      return { prompts: [] };
  }
  throw new RpcError(-32601, `Method not found: ${method}`);
}

async function handleMessage(env: Env, msg: any): Promise<object | null> {
  if (!(msg && typeof msg === "object" && msg.jsonrpc === "2.0" && typeof msg.method === "string")) {
    return msg && typeof msg === "object" && "id" in msg ? rpcError(msg.id ?? null, -32600, "Invalid request") : null;
  }
  if (!("id" in msg)) return null; // a notification (e.g. notifications/initialized): no answer
  try {
    return { jsonrpc: "2.0", id: msg.id, result: await dispatch(env, msg.method, msg.params ?? {}) };
  } catch (err) {
    if (err instanceof RpcError) return rpcError(msg.id, err.code, err.message);
    console.error("mcp", err);
    return rpcError(msg.id, -32603, "Internal error");
  }
}

/** Handle one HTTP request to the MCP endpoint. */
export async function handleMcp(request: Request, env: Env): Promise<Response> {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (request.method !== "POST") {
    return json({ error: "method_not_allowed", message: "POST JSON-RPC messages to this URL" }, 405);
  }
  const text = await request.text();
  if (text.length > 64 * 1024) return json(rpcError(null, -32600, "Request too large"), 413);
  let body: any;
  try {
    body = JSON.parse(text);
  } catch {
    return json(rpcError(null, -32700, "Parse error"), 400);
  }
  if (Array.isArray(body)) {
    if (!body.length) return json(rpcError(null, -32600, "Empty batch"), 400);
    const out = [];
    for (const m of body.slice(0, 10)) {
      const r = await handleMessage(env, m);
      if (r) out.push(r);
    }
    return out.length ? json(out) : new Response(null, { status: 202, headers: CORS });
  }
  const out = await handleMessage(env, body);
  return out ? json(out) : new Response(null, { status: 202, headers: CORS });
}
