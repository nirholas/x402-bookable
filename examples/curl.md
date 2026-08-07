# Raw HTTP walkthrough: 402 → pay → 200

x402 is plain HTTP. Here is the exact wire flow with `curl` against a local
server (`npm run dev` — it ships with working default receive addresses).

## 1. Free routes need no payment

```bash
curl -s http://localhost:4022/services | jq
curl -s http://localhost:4022/.well-known/x402 | jq
```

`/services` gives you the catalogue — service ids, durations, modes, hours,
cancellation policy, and the two payment rails.

## 2. Calling a paid route without payment → HTTP 402

```bash
curl -si "http://localhost:4022/slots?service=consult-30"
```

```
HTTP/1.1 402 Payment Required
Content-Type: application/json

{
  "x402Version": 1,
  "error": "X-PAYMENT header is required",
  "accepts": [
    {
      "scheme": "exact",
      "network": "base-sepolia",
      "maxAmountRequired": "1000",
      "resource": "http://localhost:4022/slots",
      "description": "Bookable start times for one service or every service…",
      "mimeType": "application/json",
      "payTo": "0x40252CFDF8B20Ed757D61ff157719F33Ec332402",
      "maxTimeoutSeconds": 300,
      "asset": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
      "extra": { "name": "USDC", "version": "2" }
    },
    {
      "scheme": "exact",
      "network": "solana",
      "maxAmountRequired": "1000",
      "resource": "http://localhost:4022/slots",
      "description": "Bookable start times for one service or every service…",
      "mimeType": "application/json",
      "payTo": "WwwuGbqHrwF5RG89KhUbmRWEvjnRH9k5kVM5p7T3WwW",
      "maxTimeoutSeconds": 300,
      "asset": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      "extra": { "rpcUrl": "https://api.mainnet-beta.solana.com" }
    }
  ]
}
```

Two entries, two rails: **USDC on Base** and **USDC on Solana**. `1000` is
0.001 USDC in atomic units (6 decimals). Pick one, ignore the other.

```bash
# just the rails:
curl -s "http://localhost:4022/slots" | jq '.accepts[] | {network, payTo, asset, maxAmountRequired}'
```

## 3. Pay: sign the requirement, retry with X-PAYMENT

**Base rail:** the client signs an EIP-3009 `transferWithAuthorization` for the
amount in the `base-sepolia` entry and base64-encodes the signed payload into one
header.

**Solana rail:** the client builds an SPL `transferChecked` of `1000` USDC atomic
units to the `solana` entry's `payTo`, signs the serialized transaction, and
base64-encodes that envelope into the same header.

Either way it is one header. Doing it by hand is miserable — use the client
instead:

```bash
PRIVATE_KEY=0x... npm run client        # runs examples/agent-client.ts
```

Under the hood it retries:

```
GET /slots?service=consult-30
X-PAYMENT: eyJ4NDAyVmVyc2lvbiI6MSwic2NoZW1lIjoiZXhhY3QiLC...
```

## 4. 200 + artifact + settlement receipt

```
HTTP/1.1 200 OK
X-PAYMENT-RESPONSE: eyJzdWNjZXNzIjp0cnVlLCJ0cmFuc2FjdGlvbiI6IjB4YWJjLi4uIiwibmV0d29yayI6ImJhc2Utc2Vwb2xpYSJ9
Content-Type: application/json

{ "provider": {...}, "services": [ { "serviceId": "consult-30", "openSlots": 139, "slots": [...] } ] }
```

`X-PAYMENT-RESPONSE` base64-decodes to the settlement result — `{ success,
transaction, network, payer }`. The `network` field tells you which rail actually
settled. That is your on-chain receipt.

Settlement runs *after* the handler succeeds: if the slot was taken in the
meantime you get `409 SLOT_TAKEN` and no money moves.

## 5. Booking and cancelling

```bash
# paid ($0.01 refundable hold) — via the client, or any x402 library.
# returns: appointmentId, time, meetingLink, cancelToken, ics (base64), signature

# free cancel with the cancelToken from the booking artifact:
curl -s -X POST http://localhost:4022/cancel/apt_XXXX \
  -H 'content-type: application/json' \
  -d '{"cancelToken":"YOUR_TOKEN"}' | jq

# free lookup:
curl -s "http://localhost:4022/appointments/apt_XXXX?cancelToken=YOUR_TOKEN" | jq
```

## 6. Save the calendar invite

```bash
jq -r .ics confirmation.json | base64 -d > appointment.ics
```
