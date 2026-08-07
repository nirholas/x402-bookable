# Tutorial — from zero to a booked appointment

This walkthrough takes you from clone to a booked (and cancelled) appointment
using real x402 payments — **USDC on Base Sepolia or on Solana**, your choice.

## 1. Install

```bash
git clone https://github.com/nirholas/x402-bookable
cd x402-bookable
npm install
```

Requirements: Node 18+.

## 2. Configure

The server runs unconfigured — `.env.example` ships with the suite's public
receive addresses on both rails, and the startup banner reminds you they're the
defaults. To take the money yourself, copy the template and set both:

```bash
cp .env.example .env
# edit .env →
#   PAY_TO_ADDRESS=0xYourBaseAddress            (EVM rail)
#   SOLANA_PAY_TO_ADDRESS=YourSolanaAddress     (Solana rail)
```

You can also run one rail only: drop an address and that rail is omitted from
every 402 (the server logs which one it skipped).

Describe your real business in `config/services.json`:

- `provider` — name, description, timezone, physical location
- `hours` — opening hours per weekday (`null` = closed)
- `services` — each with `id`, `name`, `durationMinutes`, `mode`
  (`video` / `in-person` / `phone`), `description`, and an optional
  `bufferMinutes` of protected time after the appointment
- `slotMinutes` — the booking grid (default 15)
- `bookingWindowDays` — how far ahead people may book
- `cancelPolicy` — hold price, free-cancellation window, and the wording
  customers see
- `meetingLinkBase` — optional; `video` services get
  `<meetingLinkBase>/<appointmentId>` as their join link

## 3. Run the server

```bash
npm run dev
```

You'll see the banner with paid routes, prices, and both rails. Sanity checks:

```bash
curl -s http://localhost:4022/health | jq
curl -s http://localhost:4022/services | jq
curl -s http://localhost:4022/.well-known/x402 | jq
```

## 4. Your first 402

Call a paid route without paying:

```bash
curl -si "http://localhost:4022/slots?service=consult-30" | head -20
```

You get `HTTP/1.1 402 Payment Required` and a JSON body whose `accepts[]` array
has **two entries** — one per rail:

```bash
curl -s "http://localhost:4022/slots" | jq '.accepts[] | {network, payTo, asset, maxAmountRequired}'
```

```json
{ "network": "base-sepolia", "payTo": "0x40252CFD…", "asset": "0x036CbD53…", "maxAmountRequired": "1000" }
{ "network": "solana",       "payTo": "WwwuGbqH…",  "asset": "EPjFWdd5…",  "maxAmountRequired": "1000" }
```

Each entry states the exact amount (atomic USDC units, 6 decimals), the token
address, the recipient, and the network. This is the whole protocol: the 402 *is*
the price list, and it quotes in two currencies of the same dollar.

## 5. Fund a client wallet

**Base rail (what the bundled client uses):** create a throwaway key (e.g.
`openssl rand -hex 32` prefixed with `0x`, or export one from a test wallet) and
fund it with **Base Sepolia USDC** from <https://faucet.circle.com>. A few cents'
worth is plenty.

**Solana rail:** any wallet holding USDC works — Phantom in the browser demo, or
a keypair in an agent. Set `SOLANA_NETWORK=devnet` to test against devnet USDC
instead of mainnet.

## 6. Make the paid calls

```bash
PRIVATE_KEY=0xYourFundedKey npm run client
```

`examples/agent-client.ts` will:

1. read the free manifest and service catalogue,
2. pay **$0.001** for `GET /slots`,
3. pay **$0.01** (refundable hold) for `POST /appointments` on the first open
   time,
4. print the confirmation artifact — appointment id, service, meeting link,
   cancel policy, `cancelToken`, HMAC signature — plus the decoded
   `X-PAYMENT-RESPONSE` settlement receipt, which names the rail and the
   transaction,
5. decode the base64 `ics` field into a calendar invite,
6. cancel for free with the `cancelToken` and print the refund ledger entry.

## 7. Reading the artifact

Everything you paid for is in the 200 body:

- `appointmentId` — your reference; `cancelToken` — bearer credential for
  cancellation and lookup. Store both.
- `meetingLink` — present for `video` services; in-person bookings carry the
  provider address as `location` instead.
- `ics` — base64 `.ics`; `Buffer.from(ics, "base64")` and save to a file to
  import into any calendar.
- `signature` — HMAC-SHA256 over the canonical confirmation JSON with the
  server's `SIGNING_SECRET`; tamper-evidence for disputes.
- `ledgerEntry` — the recorded hold. Cancelling outside the free-cancellation
  window (12h by default) yields a `refund` entry; inside it, a `forfeit`.

## 8. The human checkout

Open <http://localhost:4022> — a Calendly-style page using the drop-in
`@three-ws/x402-payment-modal`. Pick a service, pay for the grid, tap a time, pay
the hold from a browser wallet — **Phantom / Solflare / Backpack on Solana, or
MetaMask on Base** — download the invite, cancel with one click. The modal reads
the dual-rail 402 and offers the wallets it detects; SIWX re-entry means a
returning customer signs in instead of paying twice, and spending caps bound what
the page can charge.

The Solana browser path needs one server route (Phantom signs serialized
transactions, so the SPL transfer has to be built server-side). `src/checkout.ts`
mounts it at `/api/x402-checkout`; if its optional peer deps are missing the
banner says `Solana browser checkout: disabled` and the Base path still works.

## 9. Going to mainnet

1. Set `NETWORK=base` (the Solana rail already defaults to mainnet — set
   `SOLANA_NETWORK=devnet` if you want it on devnet instead).
2. Point `FACILITATOR_URL` at a production facilitator for Base (e.g. Coinbase
   Developer Platform's x402 facilitator). The Solana rail settles through
   `SOLANA_FACILITATOR_URL`, which defaults to PayAI's
   (`https://facilitator.payai.network`) — no public facilitator handles both
   chains.
3. Replace the public Solana RPC: set `SOLANA_RPC_URL` to a dedicated endpoint
   (Helius / Triton / QuickNode). The default is rate-limited and will fail
   under load.
4. Set a strong `SIGNING_SECRET`.
5. Use real merchant wallets for `PAY_TO_ADDRESS` **and**
   `SOLANA_PAY_TO_ADDRESS`.
6. Deploy behind HTTPS (agents will refuse to pay plaintext endpoints) and keep
   `data/` on a persistent volume.

Prices stay in dollar strings (`$0.01`) — the paywall converts to atomic USDC on
whichever network the client picks.
