# API reference

Base URL: your deployment (default `http://localhost:4022`). Machine-readable
spec: [`openapi.json`](https://github.com/nirholas/x402-bookable/blob/main/openapi.json).
All prices are in USDC and payable on **either** rail — Base (EVM) or Solana.
Paid routes return `402 Payment Required` until called with a valid `X-PAYMENT`
header; successful paid responses carry an `X-PAYMENT-RESPONSE` settlement
receipt header.

---

## GET /slots — $0.001

Bookable start times across the booking window. A time is offered only when the
whole service duration (plus its optional buffer) fits inside opening hours and
nothing else is booked over it.

| Param | Type | Notes |
|---|---|---|
| `service` | string | Service id from `GET /services`. Omit for every service. |
| `date` | `YYYY-MM-DD` | Restrict to one day. |
| `days` | integer | Days to scan when no `date` is given. Capped at `bookingWindowDays`. |

**200**

```json
{
  "provider": { "name": "Dr. Ada's Practice", "timezone": "America/New_York", "location": "402 Payment Ave, Suite 3" },
  "slotMinutes": 15,
  "cancelPolicy": { "holdPrice": "$0.01", "freeCancellationHours": 12, "description": "…" },
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

**Errors**: `402` (no/invalid payment), `404 UNKNOWN_SERVICE`.

---

## POST /appointments — $0.01 (refundable hold)

Claims the time and returns the confirmation artifact in the same response.

**Body**

```json
{
  "service": "consult-30",
  "date": "2026-08-08",
  "time": "09:00",
  "name": "Ada Lovelace",
  "email": "ada@example.com",
  "notes": "first visit"
}
```

`service`, `date`, `time` and `name` are required. `email` and `notes` are
optional. The payer wallet is taken from the settled payment (or the
`X-Payer-Address` header) and recorded on the hold ledger entry.

**200 — the purchased artifact**

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
  "cancelPolicy": { "holdPrice": "$0.01", "freeCancellationHours": 12, "description": "…" },
  "cancelToken": "3f9c…",
  "cancelEndpoint": "POST /cancel/apt_1a2b3c4d5e6f",
  "ledgerEntry": { "entryId": "led_…", "kind": "hold", "amount": "$0.01", "reason": "refundable appointment hold paid via x402", "at": "…" },
  "ics": "QkVHSU46VkNBTEVOREFS… (base64 .ics)",
  "signature": "hex HMAC-SHA256",
  "createdAt": "2026-08-07T18:00:01.000Z"
}
```

`meetingLink` is present only for `mode: "video"` services.

| Status | Code | Meaning |
|---|---|---|
| 400 | `INVALID_SERVICE` / `INVALID_DATE` / `INVALID_TIME` / `INVALID_NAME` | malformed body |
| 402 | — | payment missing/invalid |
| 404 | `UNKNOWN_SERVICE` | no such service id |
| 409 | `OUTSIDE_HOURS` | the service does not fit at that time |
| 409 | `SLOT_IN_PAST` | that time has already passed |
| 409 | `SLOT_TAKEN` | someone booked it first — re-read `/slots` |

None of the `4xx` cases charge the caller: settlement is deferred until the
handler returns `2xx`.

---

## POST /cancel/:id — free (auth: cancelToken)

**Body**: `{ "cancelToken": "..." }`, or send the header `X-Cancel-Token`.

**200**

```json
{
  "appointmentId": "apt_1a2b3c4d5e6f",
  "status": "cancelled",
  "cancelledAt": "2026-08-07T18:04:00.000Z",
  "refunded": true,
  "refundLedgerEntry": { "kind": "refund", "amount": "$0.01", "reason": "cancelled 38.9h before the appointment — hold refunded" },
  "ledger": [{ "kind": "hold" }, { "kind": "refund" }],
  "signature": "…"
}
```

`refunded: false` (`kind: "forfeit"`) when cancelling inside the
free-cancellation window.

**Errors**: `403 BAD_CANCEL_TOKEN`, `404 NOT_FOUND`, `409 ALREADY_CANCELLED`.

---

## Free routes

| Route | Returns |
|---|---|
| `GET /services` | provider profile, hours, service catalogue, cancel policy, prices, payment rails |
| `GET /appointments/:id?cancelToken=…` | appointment + full ledger |
| `GET /health` | liveness |
| `GET /.well-known/x402` | x402 discovery manifest (resources, prices, schemas, both rails) |

---

## 402 response shape

Paid routes answer an unpaid request with a `402` whose `accepts` array carries
**both payment rails**. Pick one, sign it, retry with `X-PAYMENT`.

```json
{
  "x402Version": 1,
  "error": "X-PAYMENT header is required",
  "accepts": [
    {
      "scheme": "exact",
      "network": "base-sepolia",
      "maxAmountRequired": "10000",
      "resource": "http://localhost:4022/appointments",
      "description": "Book an appointment with a refundable hold…",
      "mimeType": "application/json",
      "payTo": "0x40252CFDF8B20Ed757D61ff157719F33Ec332402",
      "asset": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
      "maxTimeoutSeconds": 300,
      "extra": { "name": "USDC", "version": "2" }
    },
    {
      "scheme": "exact",
      "network": "solana",
      "maxAmountRequired": "10000",
      "resource": "http://localhost:4022/appointments",
      "description": "Book an appointment with a refundable hold…",
      "mimeType": "application/json",
      "payTo": "WwwuGbqHrwF5RG89KhUbmRWEvjnRH9k5kVM5p7T3WwW",
      "asset": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      "maxTimeoutSeconds": 300,
      "extra": { "rpcUrl": "https://api.mainnet-beta.solana.com" }
    }
  ]
}
```

| Field | Meaning |
|---|---|
| `network` | `base-sepolia`/`base` = EVM rail; `solana`/`solana-devnet` = SVM rail |
| `maxAmountRequired` | price in atomic USDC units (6 decimals) — `10000` = $0.01 |
| `asset` | USDC contract address (EVM) or SPL mint (Solana) |
| `payTo` | merchant receive address on that network |
| `extra` | EVM: the EIP-712 domain to sign against. Solana: the RPC to build against. |

Configure the rails with `NETWORK` / `PAY_TO_ADDRESS` (EVM) and `SOLANA_NETWORK`
/ `SOLANA_PAY_TO_ADDRESS` / `SOLANA_RPC_URL` (Solana). Drop an address and that
rail is omitted from every challenge.

## Settlement receipt

A successful paid call returns `X-PAYMENT-RESPONSE`: base64 JSON of
`{ success, transaction, network, payer }`. `network` tells you which rail
settled. Settlement is deferred until the handler returns `2xx` — an error
response (e.g. `409 SLOT_TAKEN`) never moves funds.

## Contact

**nichxbt@gmail.com** · [issues](https://github.com/nirholas/x402-bookable/issues)
