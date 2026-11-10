---
name: appointment-booking-api
description: List open appointment slots and book one through a self-hosted x402-bookable server, paying a refundable hold in USDC. Use when an agent must find and reserve a time with a salon, clinic or consultant that runs this server.
---

# x402-bookable

A Calendly-style server a provider runs themselves. Services, hours and buffers
come from `config/services.json` (`SERVICES_CONFIG`), data is stored under
`DATA_DIR`, and `SIGNING_SECRET` signs confirmations. The base URL is the
provider's own deployment.

## Run the server

It is a self-hosted Node server (Express, Node 18 or newer). Run it from a clone:

```bash
git clone https://github.com/nirholas/x402-bookable && cd x402-bookable
npm install
cp .env.example .env     # then adjust; see the comments in the file
npm run dev              # tsx src/server.ts, listens on PORT (default 4022)
```

`npm run build` then `npm start` runs the compiled server. `npm run client`
runs `examples/agent-client.ts`, a reference paying client. Set `PAY_TO_ADDRESS`
and `SOLANA_PAY_TO_ADDRESS` to your own wallets to be paid yourself.

## Routes

| Route | Price | Purpose |
| --- | --- | --- |
| `GET /slots` | $0.001 | optional `service`, `date` (YYYY-MM-DD), `days`; returns services with `slots[]` |
| `POST /appointments` | $0.01 refundable hold | body `service`, `date`, `time`, `name`, `email`, optional `notes` |
| `POST /cancel/:id` | free | body `cancelToken` (or header `X-Cancel-Token`) |
| `GET /appointments/:id?cancelToken=` | free | appointment and ledger |
| `GET /services` | free | provider profile, catalogue, cancel policy, prices |
| `GET /health`, `GET /.well-known/x402` | free | |

The booking response is signed and holds `appointmentId`, `time`, `endsAt`,
`cancelToken`, `cancelEndpoint`, `ledgerEntry`, a base64 `ics` invite and, for
video services, `meetingLink`. Keep `cancelToken`. Cancelling outside the free
window returns `refunded: false`.

Errors: 400 `INVALID_SERVICE`, `INVALID_DATE`, `INVALID_TIME`, `INVALID_NAME`;
404 `UNKNOWN_SERVICE`, `NOT_FOUND`; 409 `OUTSIDE_HOURS`, `SLOT_IN_PAST`,
`SLOT_TAKEN` (nothing settles on a 409); 403 `BAD_CANCEL_TOKEN`.

Read `GET /services` first (free), then `GET /slots`, then book the slot.

## Paying (x402)

Paid routes follow the x402 protocol. An unpaid call returns HTTP 402 with an
`accepts` array listing USDC on Base and USDC on Solana. Sign for one rail,
retry with the base64 payload in the `X-PAYMENT` header, and the 200 body
carries the result; the settlement receipt is in the `X-PAYMENT-RESPONSE`
header. Clients: `x402-fetch` (EVM), `@three-ws/x402-payment-modal` (browser,
both rails), or any x402 client. The rail networks are chosen by `NETWORK`
(EVM, `base-sepolia` by default) and `SOLANA_NETWORK` in `.env`; see
`.env.example`. Settlement moves real USDC on the chosen network: show the user
the recipient, amount and network and get an explicit yes before every paid call.
