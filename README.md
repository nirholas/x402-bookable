# x402-bookable

**Self-hosted Calendly for the agent economy** — an appointment booking server
that salons, clinics, and consultants run themselves and sell directly to AI
agents (and humans) with [x402](https://x402.org) micropayments. Reading the open
grid costs $0.001, booking is a **$0.01 refundable hold**, and every payment
returns its artifact — appointment, meeting link, cancel token, cancellation
policy, calendar invite — in the same HTTP response.

[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![x402](https://img.shields.io/badge/payments-x402%20%C2%B7%20USDC-0052ff.svg)](https://x402.org)
[![rails](https://img.shields.io/badge/rails-Base%20%2B%20Solana-14f195.svg)](#how-x402-works)
[![Docs](https://img.shields.io/badge/docs-GitHub%20Pages-0052ff.svg)](https://nirholas.github.io/x402-bookable/)

## Why x402 for this

Scheduling platforms take a cut, own your customer relationship, and make an
agent go through a signup funnel designed for humans. With x402 the transaction
*is* the authentication: any wallet — human or agent — pays $0.001 to read your
real availability and puts down a $0.01 refundable USDC hold to claim a slot, no
account, subscription, or integration contract. The hold gives you skin in the
game against no-shows while staying trivially refundable on timely cancellation,
and the entire booking round-trip is four HTTP calls.

## Quickstart

```bash
git clone https://github.com/nirholas/x402-bookable
cd x402-bookable && npm install

# your services, hours and cancellation policy live in config/services.json
npm run dev
```

The server ships with the suite's public receive addresses so it runs out of the
box. Set `PAY_TO_ADDRESS` (Base) and `SOLANA_PAY_TO_ADDRESS` (Solana) in `.env`
to receive the payments yourself.

Then, in another terminal, run the full agent flow (slots → book → cancel):

```bash
PRIVATE_KEY=0xFundedBaseSepoliaKey npm run client
```

Fund the client wallet with testnet USDC at
[faucet.circle.com](https://faucet.circle.com). Open <http://localhost:4022> for
the human checkout demo.

## API

| Route | Price | What you get back |
|---|---|---|
| `GET /slots` | $0.001 | Open start times per service — `date`, `time`, `endsAt`, plus duration, mode, and the cancellation policy |
| `POST /appointments` | $0.01 (refundable hold) | `{appointmentId, time, endsAt, service, meetingLink?, location, cancelPolicy, cancelToken, ledgerEntry, ics (base64 invite), signature}` |
| `POST /cancel/:id` | free (auth: `cancelToken`) | Cancellation record + refund ledger entry, signed |
| `GET /appointments/:id` | free (auth: `cancelToken`) | Appointment + full ledger |
| `GET /services`, `GET /health`, `GET /.well-known/x402` | free | Catalogue / liveness / machine-readable payment manifest |

Full reference: [docs/api.md](docs/api.md) · [openapi.json](openapi.json)

## How x402 works

**Pay in USDC on Base or Solana — your client picks the rail.**

1. Client calls a paid route with no payment → server answers **`402 Payment
   Required`** with an `accepts[]` array holding **both rails**: USDC on Base
   (`base-sepolia` by default) and USDC on Solana, each with amount, token
   address, and recipient.
2. Client picks one and signs — EVM: an EIP-3009 `transferWithAuthorization`;
   Solana: an SPL `transferChecked` — then retries with the **`X-PAYMENT`**
   header.
3. The facilitator for that rail **verifies and settles** on the chosen chain —
   x402.org's for Base, PayAI's for Solana (each overridable by env; no public
   facilitator settles both).
4. Server responds **`200`** with the purchased artifact in the body and a
   settlement receipt in **`X-PAYMENT-RESPONSE`**.

Settlement is deliberately last: the payment only settles when the route returns
`2xx`, so a slot that was taken between the client's `/slots` call and its
booking returns `409 SLOT_TAKEN` and never charges the payer.

No API keys, no invoices, no minimums — each request pays for itself. Raw
wire-level walkthrough: [examples/curl.md](examples/curl.md).

## Real backend / configuration

This server sells **real inventory you configure** — there are no fixtures and no
external API keys:

- `config/services.json` — your provider profile, opening hours, service
  catalogue (duration, mode, optional buffer time), booking grid, booking window,
  and cancellation policy.
- Appointments and the refundable-hold ledger persist to `data/*.json`
  (file-based, no database).
- `SIGNING_SECRET` — set in production; confirmations and cancellations carry an
  HMAC-SHA256 signature over canonical JSON (dev default is baked in for the
  demo).
- Refund ledger: holds, refunds, and forfeits are recorded per appointment and
  returned in-response. Settling refunded USDC back on-chain is the operator's
  action (or an automation you attach) — the signed ledger entry is the
  customer's claim.
- Payment addresses: `PAY_TO_ADDRESS` (Base) and `SOLANA_PAY_TO_ADDRESS`
  (Solana). Both default to the suite's public receive addresses so the demo runs
  unconfigured — the server prints a reminder while the defaults are active.
- Facilitators are per-rail: `FACILITATOR_URL` (EVM, default x402.org) and
  `SOLANA_FACILITATOR_URL` (Solana, default PayAI). No public facilitator settles
  both chains.
- Mainnet: `NETWORK=base` + a production EVM `FACILITATOR_URL`. Solana defaults to
  mainnet; `SOLANA_NETWORK=devnet` switches it. Use a dedicated `SOLANA_RPC_URL`
  in production.

All variables: [.env.example](.env.example)

## Human checkout

`public/index.html` is a Calendly-style checkout: pick a service, pay for the
grid, tap a time, pay the hold with the drop-in
[`@three-ws/x402-payment-modal`](https://www.npmjs.com/package/@three-ws/x402-payment-modal)
(loaded from CDN), download the .ics, cancel with one click. The modal reads the
dual-rail 402 and offers **Phantom/Solflare/Backpack on Solana or MetaMask on
Base** automatically. It also brings **SIWX wallet re-entry** (a wallet that
already paid signs back in instead of paying again) and **client-side spending
caps** (per-call / hourly / daily), so returning customers don't re-approve every
$0.01.

The Solana browser path needs one small server route — Phantom signs serialized
transactions, so the SPL transfer has to be built somewhere. `src/checkout.ts`
mounts the package's own Express adapter at `/api/x402-checkout`; if the optional
peer deps aren't installed, that path degrades and the Base path keeps working.

## For AI agents

- **[skill.md](skill.md)** — agent-facing service description (endpoints, prices,
  schemas, both payment rails).
- **[/.well-known/x402](public/.well-known/x402)** — machine-readable manifest
  served by the app; indexable by [x402scan.com](https://x402scan.com), the x402
  Bazaar, and [agentic.market](https://agentic.market). Deploy publicly and
  submit your base URL to be discovered.
- **MCP**: wrap the endpoints as Claude tools in ~80 lines — see
  [examples/mcp-tool.md](examples/mcp-tool.md).
- **Client**: [examples/agent-client.ts](examples/agent-client.ts) is the
  complete pay-slots-book-cancel loop via `x402-fetch`, with the Solana
  alternative documented inline.
- Agent guide: [docs/agents.md](docs/agents.md)

## Docs

Site: **<https://nirholas.github.io/x402-bookable/>** · [Tutorial](docs/tutorial.md)
· [API reference](docs/api.md) · [For agents](docs/agents.md)

Part of the [x402 Suite](https://github.com/nirholas/x402-suite).

## Support

Questions, integration help, or a bug report: **nichxbt@gmail.com** — or open an
[issue](https://github.com/nirholas/x402-bookable/issues).

## License

[Apache-2.0](LICENSE)
