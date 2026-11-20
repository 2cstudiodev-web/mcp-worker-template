// Calls every method once against a running server. Usage:
//   npm run dev            (in one terminal)
//   npm test               (defaults to http://127.0.0.1:8787/mcp)
//   node test/smoke.mjs https://my-mcp-server.example.workers.dev/mcp
const URL_ = process.argv[2] || "http://127.0.0.1:8787/mcp";
let id = 0, failed = 0;
const rpc = async (method, params) => {
  const r = await fetch(URL_, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }) });
  return r.json();
};
const check = (label, ok, extra = "") => { console.log(`${ok ? "ok  " : "FAIL"} ${label} ${extra}`); if (!ok) failed++; };

const init = await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "smoke", version: "1" } });
check("initialize", !!init.result?.serverInfo?.name, init.result?.protocolVersion);
const list = await rpc("tools/list", {});
const tools = list.result?.tools ?? [];
check("tools/list", tools.length > 0, tools.map((t) => t.name).join(", "));
for (const t of tools) check(`${t.name} has outputSchema + annotations`, !!t.outputSchema && !!t.annotations);

const search = await rpc("tools/call", { name: "search_tokens", arguments: { query: "bonk", limit: 2 } });
check("search_tokens", !search.result?.isError && search.result?.structuredContent?.results?.length > 0, JSON.stringify(search.result?.structuredContent).slice(0, 160));
const price = await rpc("tools/call", { name: "get_token_price", arguments: { mints: ["So11111111111111111111111111111111111111112"] } });
check("get_token_price", !price.result?.isError && price.result?.structuredContent?.prices?.[0]?.usd_price > 0, JSON.stringify(price.result?.structuredContent));
const bad = await rpc("tools/call", { name: "get_token_price", arguments: { mints: ["nope"] } });
check("bad input returns isError with a fix", bad.result?.isError === true, bad.result?.content?.[0]?.text);
const unknown = await rpc("nope/nope", {});
check("unknown method is a JSON-RPC error", unknown.error?.code === -32601);
process.exit(failed ? 1 : 0);
