# x402-bookable

Self-hosted appointment booking server payable with x402 micropayments (USDC) — a Calendly a salon, clinic, or consultancy runs itself, sellable directly to AI agents and humans with no platform in between. Query bookable start times for a small fee, then claim one with a refundable $0.01 hold. Every paid call returns its artifact in the 200 response body: `/slots` returns the open grid per service; `/appointments` returns the confirmed booking with its meeting link, cancel policy, cancel token, HMAC signature, and a base64 ICS calendar invite. Cancellation is free and authenticated by the cancel token you received when booking.

**Base URL**: `https://YOUR-DEPLOYMENT.example.com` (self-hosted — each provider runs its own instance)

**Machine-readable manifest**: `GET /.well-known/x402` (free)

## Endpoints

### GET /slots — $0.001

Bookable start times across the booking window. Slot times are the provider's local grid (default 15 minutes); a slot is offered only when the whole service duration plus its buffer fits inside opening hours and nothing else is booked over it.

Query params (all optional):
- `service` — service id (see `GET /services`); omit for every service
- `date` — `YYYY-MM-DD`, restrict to one day
- `days` — integer, scan window when no `date` given (max = configured `bookingWindowDays`)

Response:
```json
{
  "provider": { "name": "Dr. Ada's Practice", "timezone": "America/New_York", "location": "..." },
  "slotMinutes": 15,
  "cancelPolicy": { "holdPrice": "$0.01", "freeCancellationHours": 12, "description": "..." },
  "generatedAt": "2026-08-07T18:00:00.000Z",
  "services": [
    {
      "serviceId": "consult-30",
      "name": "30-minute consultation",
      "durationMinutes": 30,
      "mode": "video",
      "description": "Initial consultation over video.",
      "openSlots": 139,
      "slots": [{ "date": "2026-08-08", "time": "09:00", "endsAt": "09:30" }]
    }
  ]
}
```

Errors: `404 UNKNOWN_SERVICE`.

### POST /appointments — $0.01 (refundable hold)

Body:
```json
{ "service": "consult-30", "date": "2026-08-08", "time": "09:00", "name": "Ada Lovelace", "email": "ada@example.com", "notes": "first visit" }
```

Response (the purchased artifact — keep `cancelToken`):
```json
{
  "appointmentId": "apt_1a2b3c4d5e6f",
  "status": "confirmed",
  "provider": "Dr. Ada's Practice",
  "service": { "id": "consult-30", "name": "30-minute consultation", "durationMinutes": 30, "mode": "video" },
  "time": "2026-08-08T09:00",
  "endsAt": "2026-08-08T09:30",
  "name": "Ada Lovelace",
  "email": "ada@example.com",
  "location": "https://meet.example.com/apt_1a2b3c4d5e6f",
  "meetingLink": "https://meet.example.com/apt_1a2b3c4d5e6f",
  "cancelPolicy": { "holdPrice": "$0.01", "freeCancellationHours": 12, "description": "..." },
  "cancelToken": "3f9c…32 hex chars",
  "cancelEndpoint": "POST /cancel/apt_1a2b3c4d5e6f",
  "ledgerEntry": { "kind": "hold", "amount": "$0.01", "reason": "refundable appointment hold paid via x402" },
  "ics": "QkVHSU46VkNBTEVOREFS… (base64 .ics file)",
  "signature": "hex HMAC-SHA256 over the canonical confirmation JSON",
  "createdAt": "2026-08-07T18:00:01.000Z"
}
```

`meetingLink` is present for `mode: "video"` services; in-person services return the provider address as `location`.

Errors: `400 INVALID_SERVICE|INVALID_DATE|INVALID_TIME|INVALID_NAME`, `404 UNKNOWN_SERVICE`, `409 OUTSIDE_HOURS|SLOT_IN_PAST|SLOT_TAKEN`.

### POST /cancel/:id — free (auth: cancelToken)

Body: `{ "cancelToken": "..." }` (or header `X-Cancel-Token`).

Response: cancellation record + refund ledger entry, signed:
```json
{
  "appointmentId": "apt_1a2b3c4d5e6f",
  "status": "cancelled",
  "cancelledAt": "2026-08-07T18:04:00.000Z",
  "refunded": true,
  "refundLedgerEntry": { "kind": "refund", "amount": "$0.01", "reason": "cancelled 38.9h before the appointment — hold refunded" },
  "ledger": [{ "kind": "hold" }, { "kind": "refund" }],
  "signature": "..."
}
```

`refunded` is `false` (`kind: "forfeit"`) when cancelling inside the free-cancellation window. Errors: `404 NOT_FOUND`, `403 BAD_CANCEL_TOKEN`, `409 ALREADY_CANCELLED`.

### Free routes

- `GET /services` — provider profile, hours, service catalogue, cancel policy, prices, payment rails
- `GET /appointments/:id?cancelToken=...` — appointment + ledger
- `GET /health` — liveness
- `GET /.well-known/x402` — this service's payment manifest

## Payment

**Pay in USDC on Base or Solana — your client picks the rail.** Every paid route
answers an unpaid request with a `402` whose `accepts` array carries both rails;
choose the one your wallet can settle and ignore the other.

- Protocol: [x402](https://x402.org) (HTTP 402 Payment Required), `x402Version: 1`, scheme `exact`
- **EVM rail** — network `base-sepolia` (default; `NETWORK=base` for mainnet), asset USDC
  (`0x036CbD53842c5426634e7929541eC2318f3dCF7e` on base-sepolia), payTo
  `0x40252CFDF8B20Ed757D61ff157719F33Ec332402`
- **Solana rail** — network `solana` (`SOLANA_NETWORK=devnet` for `solana-devnet`), asset USDC
  (`EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`), payTo
  `WwwuGbqHrwF5RG89KhUbmRWEvjnRH9k5kVM5p7T3WwW`
- Facilitators (one per rail — no public facilitator settles both chains):
  EVM `https://x402.org/facilitator` (`FACILITATOR_URL`), Solana
  `https://facilitator.payai.network` (`SOLANA_FACILITATOR_URL`)
- Flow: call the route → receive `402` + `accepts[]` → sign the USDC payment for one rail
  (EVM: EIP-3009 `transferWithAuthorization`; Solana: SPL `transferChecked`) → retry with the
  `X-PAYMENT` header → receive `200` + the artifact in the body + an
  `X-PAYMENT-RESPONSE` settlement receipt naming the rail and transaction.
- Clients: `x402-fetch` (EVM), `@three-ws/x402-payment-modal` (browser, both rails),
  or any x402-compatible client.
- Settlement happens only when the route returns `2xx`. A slot that was taken between your
  `/slots` call and your booking returns `409 SLOT_TAKEN` and costs you nothing.

Example 402 body:

```json
{
  "x402Version": 1,
  "error": "X-PAYMENT header is required",
  "accepts": [
    { "scheme": "exact", "network": "base-sepolia", "asset": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
      "payTo": "0x40252CFDF8B20Ed757D61ff157719F33Ec332402", "maxAmountRequired": "10000",
      "resource": "https://YOUR-DEPLOYMENT.example.com/appointments", "mimeType": "application/json",
      "maxTimeoutSeconds": 300, "description": "Book an appointment with a refundable hold…" },
    { "scheme": "exact", "network": "solana", "asset": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      "payTo": "WwwuGbqHrwF5RG89KhUbmRWEvjnRH9k5kVM5p7T3WwW", "maxAmountRequired": "10000",
      "resource": "https://YOUR-DEPLOYMENT.example.com/appointments", "mimeType": "application/json",
      "maxTimeoutSeconds": 300, "description": "Book an appointment with a refundable hold…" }
  ]
}
```

## Booking guidance for agents

- Call `GET /slots` before booking — the grid changes between calls.
- On `409 SLOT_TAKEN`, re-read `/slots` rather than retrying the same time.
- Booking is **not idempotent**: two `POST /appointments` calls book two appointments. Record `appointmentId` before retrying a network failure.
- Cancel as soon as plans change — outside the free-cancellation window the response carries a signed `refund` ledger entry; inside it, a `forfeit`.

## Verifying signatures

`signature` fields are HMAC-SHA256 (hex) over the canonical JSON (sorted keys, `signature` field excluded) using the server's `SIGNING_SECRET`. Verify with the exported `verify()` in `src/sign.ts` if you share the secret, or treat the signature as a tamper-evidence tag issued by the provider.

## Contact

Questions, integration help, or a bug: **nichxbt@gmail.com** ·
[github.com/nirholas/x402-bookable](https://github.com/nirholas/x402-bookable)
