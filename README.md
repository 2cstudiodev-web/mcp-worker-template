# mcp-worker-template

A small, production-shaped **remote MCP server on Cloudflare Workers**. Clone it, replace two example tools with calls to your own API, deploy, and Claude, ChatGPT, Cursor and VS Code can use your product.

- **Stateless Streamable HTTP**: one `POST /mcp` endpoint answering JSON-RPC. No sessions or storage, so it scales like any Worker route and costs next to nothing.
- **Tools written the way agents read them**: every tool has a what/when/freshness description, an example in every parameter, an `outputSchema` and annotations. This is the same pattern our [RipSeek MCP server](https://ripseek.2cstudio.app/blog/ripseek-mcp) uses; it scored **A** on Glama's tool-quality rating.
- **Errors the model can recover from**: bad input comes back as a normal result with `isError: true` and a sentence saying what to fix, instead of a protocol error.
- **No dependencies at runtime**: plain TypeScript, about 250 lines.

The example tools (`search_tokens`, `get_token_price`) read Jupiter's free public API, so the server works the moment you run it.

## Run it

```bash
npm install
npm run dev          # http://127.0.0.1:8787/mcp
npm test             # in another terminal: calls every method once
```

Try it in an MCP client while it runs locally, for example Claude Code:

```bash
claude mcp add --transport http my-server http://127.0.0.1:8787/mcp
```

## Make it yours

1. **`src/tools.ts`**: replace the two example tools. Each tool is a definition (what the model reads) plus a `case` in `callTool` (what runs). Throw `ToolError("...")` for anything the caller can fix.
2. **`src/mcp.ts`**: set `SERVER_INFO` (name, title, version) and `INSTRUCTIONS` (one paragraph: what the server is for and which tool to start with).
3. **`wrangler.jsonc`**: rename the Worker. API keys go in as secrets: `npx wrangler secret put MY_API_KEY`, then add the name to `Env` in `src/mcp.ts`.
4. Deploy:

```bash
npx wrangler login
npm run deploy       # https://<name>.<your-subdomain>.workers.dev/mcp
```

For a custom domain such as `mcp.yourcompany.com`, add a route in `wrangler.jsonc`:

```jsonc
"routes": [{ "pattern": "mcp.yourcompany.com", "custom_domain": true }]
```

## Tool descriptions that work

What we learned getting a server to an A on Glama, and agents to pick the right tool:

1. **First sentence: what it does and what comes back.**
2. **When to use it, and when to use another tool instead.** Agents choose between your tools by reading these.
3. **What it touches and how fresh the data is**: "Read-only; live prices, a few seconds old."
4. **An example in every parameter**, not just a type.
5. **An `outputSchema`**, kept loose (`additionalProperties: true`) so strict clients never reject a reply.
6. **Annotations**: `readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`.
7. **Verb-first names** (`get_`, `list_`, `search_`). If you rename a tool later, keep the old name working as an alias.

Start read-only. Agents, directories and users trust read-only tools most, and the Claude connector directory doesn't accept tools that move money or crypto.

## Get listed

1. **Official MCP Registry.** Edit `server.json` and publish it with Anthropic's [`mcp-publisher`](https://github.com/modelcontextprotocol/registry). Use a namespace you can prove: `com.yourcompany/<server>` through a DNS TXT record on your domain, or `io.github.<org>/<server>` through GitHub. Your own domain tells everyone the server is the official one.
2. **Glama, PulseMCP and others** pick servers up from the registry, usually within a day. Claim yours on Glama to see its score and analytics.
3. **Awesome lists** come last: some require the Glama badge first. Read each list's contributing rules.
4. **Claude connector directory**: submitted by the company itself from its Claude admin settings. It needs OAuth if your server needs sign-in, a privacy policy, and read-only or destructive labels on every tool.

More detail: [How we got our MCP server an A on Glama](https://2cstudio.app/blog/mcp-server-glama-a-grade).

## Want it built for you?

[2C Studio](https://2cstudio.app) builds MCP servers on existing APIs at a fixed price: on your domain, listed in the official registry and the main directories. See [2cstudio.app/services](https://2cstudio.app/services).

## License

MIT
