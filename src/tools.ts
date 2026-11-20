// Your tools. Each one is a definition (what the model reads) plus an implementation (what runs).
//
// How to write a definition agents pick correctly, and that scores well on Glama's tool-quality rating (TDQS):
//   1. First sentence: what it does and what comes back.
//   2. When to use it, and when to use another tool instead.
//   3. What it touches and how fresh the data is ("Read-only; live prices, at most 60 seconds old").
//   4. An example in every parameter description.
//   5. An outputSchema (kept loose: extra fields allowed, so strict clients never reject a reply).
//   6. Annotations: readOnlyHint, destructiveHint, idempotentHint, openWorldHint.
//   7. Verb-first names (get_..., list_..., search_...). If you rename one later, keep the old name as an alias.
//
// The two example tools read Jupiter's free public API (no key). Replace them with calls to your own API.

import type { Env } from "./mcp";

/** Throw this for problems the model can fix (bad input, not found). The message goes back to the model as-is. */
export class ToolError extends Error {}

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };
const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: "object", properties, required, additionalProperties: true });

const TOKEN = {
  type: "object",
  properties: {
    mint: { type: "string" },
    name: { type: "string" },
    symbol: { type: "string" },
    usd_price: { type: ["number", "null"] },
    holders: { type: ["number", "null"] },
    verified: { type: "boolean" },
  },
  additionalProperties: true,
};

export const TOOLS = [
  {
    name: "search_tokens",
    title: "Find a Solana token",
    description:
      "Finds Solana tokens by name, ticker or mint address and returns up to 10 matches with mint, price in US$, holders and whether Jupiter has verified it, " +
      "most relevant first. Use it to turn a name like 'bonk' into a mint address; use get_token_price when you already have mints and only need prices. " +
      "Read-only; live data from Jupiter. Many copies share a ticker, so prefer verified tokens with many holders.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", minLength: 1, maxLength: 60, description: "Name, ticker or mint address, e.g. 'bonk', 'JUP' or 'So11111111111111111111111111111111111111112'." },
        limit: { type: "integer", minimum: 1, maximum: 10, default: 5, description: "How many results, 1–10 (default 5)." },
      },
      required: ["query"],
      additionalProperties: false,
    },
    outputSchema: obj({ results: { type: "array", items: TOKEN } }, ["results"]),
    annotations: READ_ONLY,
  },
  {
    name: "get_token_price",
    title: "Price of Solana tokens",
    description:
      "Returns the current US$ price and 24-hour price change for 1–20 Solana token mints. " +
      "Use it when you have mint addresses and need prices; use search_tokens first if you only have a name or ticker. " +
      "Read-only; live prices from Jupiter, a few seconds old. Mints Jupiter can't price come back as null.",
    inputSchema: {
      type: "object",
      properties: {
        mints: {
          type: "array",
          minItems: 1,
          maxItems: 20,
          items: { type: "string", description: "A mint address, e.g. So11111111111111111111111111111111111111112 (SOL)." },
          description: "1–20 token mint addresses (base58).",
        },
      },
      required: ["mints"],
      additionalProperties: false,
    },
    outputSchema: obj(
      { prices: { type: "array", items: obj({ mint: { type: "string" }, usd_price: { type: ["number", "null"] }, change_24h_pct: { type: ["number", "null"] } }) } },
      ["prices"],
    ),
    annotations: READ_ONLY,
  },
];

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const round = (n: unknown, d = 6) => (typeof n === "number" && Number.isFinite(n) ? Number(n.toPrecision(d)) : null);

async function getJson(env: Env, path: string): Promise<any> {
  const res = await fetch(`${env.JUPITER_API || "https://lite-api.jup.ag"}${path}`, { headers: { accept: "application/json" } });
  if (res.status === 400) throw new ToolError(`The API rejected the request: ${(await res.text()).slice(0, 200)}`);
  if (!res.ok) throw new Error(`upstream ${res.status}`);
  return res.json();
}

export async function callTool(env: Env, name: string, args: any): Promise<Record<string, unknown>> {
  switch (name) {
    case "search_tokens": {
      const query = String(args.query ?? "").trim().slice(0, 60);
      // Say what was wrong and what to do instead: the model reads this and retries.
      if (!query) throw new ToolError("Give a token name, ticker or mint address in 'query', e.g. 'bonk'.");
      const limit = Math.min(10, Math.max(1, Math.floor(Number(args.limit) || 5)));
      const list: any[] = await getJson(env, `/tokens/v2/search?query=${encodeURIComponent(query)}`);
      return {
        results: (Array.isArray(list) ? list : []).slice(0, limit).map((t) => ({
          mint: t.id,
          name: t.name,
          symbol: t.symbol,
          usd_price: round(t.usdPrice),
          holders: t.holderCount ?? null,
          verified: !!t.isVerified,
        })),
      };
    }
    case "get_token_price": {
      const mints: string[] = Array.isArray(args.mints) ? [...new Set<string>(args.mints.map((m: unknown) => String(m).trim()))] : [];
      if (!mints.length || mints.length > 20) throw new ToolError("Give 1–20 mint addresses in 'mints'. Use search_tokens to find a mint from a name.");
      const bad = mints.find((m) => !BASE58.test(m));
      if (bad) throw new ToolError(`'${bad.slice(0, 60)}' isn't a Solana mint address (32–44 base58 characters). Use search_tokens to find it.`);
      const data = await getJson(env, `/price/v3?ids=${mints.join(",")}`);
      return {
        prices: mints.map((m) => ({ mint: m, usd_price: round(data?.[m]?.usdPrice), change_24h_pct: round(data?.[m]?.priceChange24h, 3) })),
      };
    }
  }
  throw new ToolError(`Unknown tool: ${name}`);
}
