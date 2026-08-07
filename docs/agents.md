# For AI agents

x402-bookable is built agent-first: no signup, no API key, no OAuth dance. If
your agent controls a wallet holding USDC — **on Base or on Solana** — it can
book an appointment.

## Discovery

Two machine-readable entry points, both free:

1. **`GET /.well-known/x402`** — the x402 manifest: every resource, price,
   network, asset, output schema, and both `accepts` rails. This is the format
   indexed by [x402scan.com](https://x402scan.com), the x402 Bazaar, and
   [agentic.market](https://agentic.market).
2. **[`skill.md`](https://github.com/nirholas/x402-bookable/blob/main/skill.md)**
   (repo root) — a prose+schema skill file (the agentres.dev pattern) an LLM can
   read directly to learn endpoints, prices, request shapes, and error codes.

`GET /services` (also free) is the catalogue: service ids, durations, modes,
opening hours, and the cancellation policy. Read it before paying for anything —
it tells you which `service` values are valid.

Recommended agent bootstrap: fetch `/.well-known/x402`, feed `skill.md` into
context, read `/services`, then call the paid endpoints with an x402-capable HTTP
client.

## Protocol version

This service speaks **x402 v1**. Every challenge is
`{ x402Version: 1, error, accepts: [...] }`, and each `accepts[]` entry carries
`outputSchema.input` (how to call the route) and `outputSchema.output` (what
comes back), generated from `openapi.json` so the two can never drift.

Discovery audits flag v1 as the older wire format; that is expected. x402 **v2**
— payment options under `extensions.bazaar.schema` and CAIP-2 network ids — is a
planned upgrade for agentcash compatibility. It is not adopted yet because the
v2 challenge shape would break the v1 `x402-fetch` clients this repo ships as
working examples.

## Two payment rails

Every paid route answers an unpaid request with a `402` whose `accepts` array
holds **both** rails. Your agent picks whichever it can settle:

| Rail | `network` | Asset | payTo | How the client signs |
|---|---|---|---|---|
| EVM | `base-sepolia` (default) / `base` | USDC `0x036CbD53842c5426634e7929541eC2318f3dCF7e` | `0x40252CFDF8B20Ed757D61ff157719F33Ec332402` | EIP-3009 `transferWithAuthorization` — pure client-side signature |
| Solana | `solana` (default) / `solana-devnet` | USDC `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` | `WwwuGbqHrwF5RG89KhUbmRWEvjnRH9k5kVM5p7T3WwW` | SPL `transferChecked`, signed as a serialized transaction |

Each rail is verified and settled by its own facilitator — no public
facilitator settles both chains, so the EVM rail defaults to
`https://x402.org/facilitator` and the Solana rail to
`https://facilitator.payai.network` (both overridable). The
`X-PAYMENT-RESPONSE` receipt names the rail the payment actually settled on. Ignore the entry you can't pay; the server
does not care which one you choose.

Settlement is deferred until the handler returns `2xx`, so a booking that fails
(`409 SLOT_TAKEN`) costs your agent nothing.

## Paying

Any x402 client works. With `x402-fetch` (EVM rail):

```ts
import { wrapFetchWithPayment, decodeXPaymentResponse } from "x402-fetch";
import { privateKeyToAccount } from "viem/accounts";

const payFetch = wrapFetchWithPayment(fetch, privateKeyToAccount(KEY));
const res = await payFetch(`${BASE}/appointments`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body,
});
const artifact = await res.json();                       // the appointment
const receipt = decodeXPaymentResponse(res.headers.get("x-payment-response")!); // on-chain receipt
```

The client handles the 402 → sign → retry loop automatically. Cap per-call spend
with the `maxValue` argument.

On the **Solana rail**, pick the `accepts[]` entry whose `network` starts with
`solana`, build an SPL `transferChecked` to its `payTo` for `maxAmountRequired`
atomic units of the `asset` mint (USDC, 6 decimals), sign it, and send the base64
x402 envelope in `X-PAYMENT`. Browser agents can reuse the checkout helper this
server already mounts at `POST /api/x402-checkout?action=prepare` (build) and
`?action=encode` (wrap) — see
[`examples/agent-client.ts`](https://github.com/nirholas/x402-bookable/blob/main/examples/agent-client.ts).

## What you get back (and should persist)

| Field | Why it matters |
|---|---|
| `appointmentId` | canonical reference |
| `cancelToken` | **bearer credential** — required to cancel or look up; store securely |
| `meetingLink` | join URL for `video` services; nothing else grants access |
| `cancelPolicy` | when the $0.01 hold is refundable |
| `ics` | base64 calendar invite — attach to the user's calendar |
| `signature` | provider HMAC over the artifact — keep for dispute evidence |
| `X-PAYMENT-RESPONSE` header | settlement receipt (tx hash/signature + network) — your proof of payment, on either rail |

## Booking policy for agents

- Always call `GET /slots` (paid, $0.001) before booking; the grid moves.
- On `409 SLOT_TAKEN`, re-query `/slots` rather than retrying the same time.
- Cancel with `POST /cancel/:id` as soon as plans change — outside the
  free-cancellation window the hold refunds; the response includes the signed
  refund ledger entry.
- Idempotency: booking twice books two appointments. Record `appointmentId`
  before retrying network failures.

## MCP integration

Expose the service as Claude tools (`list_services`, `find_slots`,
`book_appointment`, `cancel_appointment`) with the wrapper in
[`examples/mcp-tool.md`](https://github.com/nirholas/x402-bookable/blob/main/examples/mcp-tool.md),
including a `claude_desktop_config.json` snippet.

## Listing your deployment

Running a public instance? Get discovered:

- **x402scan.com** — indexes services exposing `/.well-known/x402`; submit your
  base URL.
- **x402 Bazaar** — the facilitator-side discovery list; keep the manifest's
  resource descriptions and output schemas accurate so listings are useful.
- **agentic.market** — agent-service marketplace; list the base URL and point at
  `skill.md`.

Keep the manifest served over HTTPS at your public origin — indexers and agents
will refuse plaintext payment endpoints.

## Contact

**nichxbt@gmail.com**
