// Entry point: the MCP endpoint at /mcp, a short page at / for people who open the URL in a browser, robots.txt.
import { handleMcp, type Env } from "./mcp";

const HOME = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>MCP server</title><body style="font:16px/1.6 system-ui;max-width:640px;margin:48px auto;padding:0 16px">
<h1>MCP server</h1><p>This is a remote MCP server. Add <code>/mcp</code> on this host as a remote (Streamable HTTP) server in Claude, ChatGPT, Cursor or VS Code.</p>
<p style="color:#666">Built from <a href="https://github.com/2cstudiodev-web/mcp-worker-template">mcp-worker-template</a>.</p></body>`;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname === "/mcp") return handleMcp(request, env);
    if (pathname === "/robots.txt") return new Response("User-agent: *\nAllow: /\n", { headers: { "content-type": "text/plain" } });
    if (pathname === "/") return new Response(HOME, { headers: { "content-type": "text/html; charset=utf-8" } });
    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
