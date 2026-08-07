# Exposing x402-bookable as an MCP tool for Claude

Model Context Protocol (MCP) lets Claude call this booking server as a native
tool. The pattern: an MCP server wraps the paid endpoints with `x402-fetch`, so
every tool call pays automatically from the agent's wallet.

The server quotes both rails in every 402 (USDC on Base and USDC on Solana);
`x402-fetch` settles the Base entry. To have the MCP server pay on Solana
instead, swap the wrapper for your own Solana signer — see
[`agent-client.ts`](agent-client.ts) for the exact envelope.

## Minimal MCP server (`mcp-server.ts`)

```ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { wrapFetchWithPayment } from "x402-fetch";
import { privateKeyToAccount } from "viem/accounts";

const BASE_URL = process.env.BOOKABLE_URL ?? "http://localhost:4022";
const account = privateKeyToAccount(process.env.PRIVATE_KEY as `0x${string}`);
const payFetch = wrapFetchWithPayment(fetch, account);

const server = new McpServer({ name: "bookable", version: "0.1.0" });

server.tool(
  "list_services",
  "List the provider's bookable services, hours, and cancellation policy (free)",
  {},
  async () => {
    const res = await fetch(`${BASE_URL}/services`);
    return { content: [{ type: "text", text: await res.text() }] };
  },
);

server.tool(
  "find_slots",
  "Find open appointment times for a service (costs $0.001 USDC via x402)",
  { service: z.string().optional(), date: z.string().optional(), days: z.number().optional() },
  async ({ service, date, days }) => {
    const qs = new URLSearchParams();
    if (service) qs.set("service", service);
    if (date) qs.set("date", date);
    if (days) qs.set("days", String(days));
    const res = await payFetch(`${BASE_URL}/slots?${qs}`);
    return { content: [{ type: "text", text: await res.text() }] };
  },
);

server.tool(
  "book_appointment",
  "Book an appointment with a $0.01 refundable x402 hold. Returns the confirmation, meeting link, cancelToken, and an ICS invite.",
  {
    service: z.string(),
    date: z.string(),
    time: z.string(),
    name: z.string(),
    email: z.string().optional(),
    notes: z.string().optional(),
  },
  async (args) => {
    const res = await payFetch(`${BASE_URL}/appointments`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(args),
    });
    return { content: [{ type: "text", text: await res.text() }] };
  },
);

server.tool(
  "cancel_appointment",
  "Cancel an appointment for free using the cancelToken from booking",
  { appointmentId: z.string(), cancelToken: z.string() },
  async ({ appointmentId, cancelToken }) => {
    const res = await fetch(`${BASE_URL}/cancel/${appointmentId}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ cancelToken }),
    });
    return { content: [{ type: "text", text: await res.text() }] };
  },
);

await server.connect(new StdioServerTransport());
```

Dependencies: `npm i @modelcontextprotocol/sdk x402-fetch viem zod`

Questions: **nichxbt@gmail.com**

## claude_desktop_config.json

```json
{
  "mcpServers": {
    "bookable": {
      "command": "npx",
      "args": ["tsx", "/path/to/mcp-server.ts"],
      "env": {
        "BOOKABLE_URL": "http://localhost:4022",
        "PRIVATE_KEY": "0x...funded base-sepolia key"
      }
    }
  }
}
```

Claude can then be asked: *"Book me a 30-minute consultation next Tuesday
morning"* — it will list services, pay for the open slots, choose one, pay the
refundable hold, and hand back the confirmation with the meeting link and
calendar invite.

## Spending safety

Give the MCP wallet a small, dedicated balance. `wrapFetchWithPayment` accepts a
`maxValue` (base units) to hard-cap what a single call may spend; combine with
per-session budgets in your agent framework. Because settlement is deferred until
the route returns `2xx`, a rejected booking never draws down that budget.
