/**
 * Full agent flow against x402-bookable:
 *   1. read the free service catalogue + manifest
 *   2. pay $0.001 for open slots
 *   3. pay $0.01 (refundable hold) to book the first open time
 *   4. print the confirmation artifact + settlement receipt
 *   5. cancel for free with the cancelToken (refund ledger entry comes back)
 *
 * Usage:
 *   PRIVATE_KEY=0x... BASE_URL=http://localhost:4022 npx tsx examples/agent-client.ts
 *
 * The wallet needs base-sepolia USDC — faucet: https://faucet.circle.com
 *
 * ── Which rail? ────────────────────────────────────────────────────────────
 * Every 402 from this server carries BOTH rails in `accepts`:
 *   [0] network "base-sepolia" | "base"    USDC via EIP-3009 transferWithAuthorization
 *   [1] network "solana" | "solana-devnet" USDC via SPL transferChecked
 * `x402-fetch` (used below) picks the EVM entry automatically. The Solana
 * alternative is at the bottom of this file.
 */
import { wrapFetchWithPayment, decodeXPaymentResponse } from "x402-fetch";
import { privateKeyToAccount } from "viem/accounts";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:4022";
const pk = process.env.PRIVATE_KEY;
if (!pk) {
  console.error("Set PRIVATE_KEY to a funded base-sepolia key (https://faucet.circle.com)");
  process.exit(1);
}

const account = privateKeyToAccount(pk as `0x${string}`);
const payFetch = wrapFetchWithPayment(fetch, account);

function receipt(res: Response): unknown {
  const header = res.headers.get("x-payment-response");
  return header ? decodeXPaymentResponse(header) : null;
}

// 1. free discovery
const manifest = await fetch(`${BASE_URL}/.well-known/x402`).then((r) => r.json());
console.log("Manifest:", manifest.name, "-", manifest.description);
console.log("Rails:", manifest.payment.rails.map((r: { network: string }) => r.network).join(" | "), "\n");

const catalogue = await fetch(`${BASE_URL}/services`).then((r) => r.json());
const service = catalogue.services[0];
console.log(`Provider: ${catalogue.provider.name}`);
console.log(`Service:  ${service.id} — ${service.name} (${service.durationMinutes}min, ${service.mode})\n`);

// 2. paid slots
const slotsRes = await payFetch(`${BASE_URL}/slots?service=${service.id}&days=7`);
if (!slotsRes.ok) throw new Error(`slots failed: ${slotsRes.status} ${await slotsRes.text()}`);
const slots = await slotsRes.json();
const offered = slots.services[0];
console.log(`Open slots for ${offered.name}: ${offered.openSlots}. Paid receipt:`);
console.log(receipt(slotsRes), "\n");

const slot = offered.slots[0];
if (!slot) throw new Error("no open slots — widen the search window");
console.log(`Booking ${slot.date} ${slot.time}–${slot.endsAt}...`);

// 3. paid booking (refundable hold)
const bookRes = await payFetch(`${BASE_URL}/appointments`, {
  method: "POST",
  headers: { "content-type": "application/json", "x-payer-address": account.address },
  body: JSON.stringify({
    service: service.id,
    date: slot.date,
    time: slot.time,
    name: "Agent Ada",
    email: "agent@example.com",
    notes: "booked autonomously via x402",
  }),
});
if (!bookRes.ok) throw new Error(`booking failed: ${bookRes.status} ${await bookRes.text()}`);
const confirmation = await bookRes.json();

// 4. the purchased artifact
console.log("\n=== CONFIRMATION ARTIFACT ===");
console.log(
  JSON.stringify({ ...confirmation, ics: `${confirmation.ics.slice(0, 40)}...` }, null, 2),
);
console.log("\nX-PAYMENT-RESPONSE settlement receipt:");
console.log(receipt(bookRes));
console.log("\nICS invite decodes to:\n");
console.log(
  Buffer.from(confirmation.ics, "base64").toString("utf8").split("\r\n").slice(0, 8).join("\n"),
  "...",
);

// 5. free cancel with the cancelToken — refund ledger entry in the response
const cancelRes = await fetch(`${BASE_URL}/cancel/${confirmation.appointmentId}`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ cancelToken: confirmation.cancelToken }),
});
const cancellation = await cancelRes.json();
console.log("\n=== CANCELLATION + REFUND LEDGER ===");
console.log(JSON.stringify(cancellation, null, 2));

// ─────────────────────────────────────────────────────────────────────────────
// Paying on the SOLANA rail instead
// ─────────────────────────────────────────────────────────────────────────────
//
// `x402-fetch` signs the EVM entry. To settle in USDC on Solana, read the same
// 402 body and act on the `solana` entry:
//
//   const res = await fetch(`${BASE_URL}/slots`);
//   const { accepts } = await res.json();
//   const sol = accepts.find((a) => a.network.startsWith("solana"));
//   // sol = { scheme: "exact", network: "solana",
//   //         asset: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",   // USDC mint
//   //         payTo: "WwwuGbqHrwF5RG89KhUbmRWEvjnRH9k5kVM5p7T3WwW",
//   //         maxAmountRequired: "1000",                               // 0.001 USDC, 6dp
//   //         extra: { rpcUrl: "https://api.mainnet-beta.solana.com" } }
//
// Build an SPL `transferChecked` of `maxAmountRequired` units of `asset` to
// `payTo`, sign it with your Solana keypair, then base64 the x402 envelope into
// `X-PAYMENT` and retry. This server also mounts the checkout helper that does
// the building for you (the same one the browser modal uses):
//
//   const prep = await fetch(`${BASE_URL}/api/x402-checkout?action=prepare`, {
//     method: "POST",
//     headers: { "content-type": "application/json" },
//     body: JSON.stringify({ accept: sol, buyer: myPublicKey }),
//   }).then((r) => r.json());
//   const signedTxBase64 = await signWithYourWallet(prep.transaction);
//   const { payment } = await fetch(`${BASE_URL}/api/x402-checkout?action=encode`, {
//     method: "POST",
//     headers: { "content-type": "application/json" },
//     body: JSON.stringify({ accept: sol, signedTxBase64, resourceUrl: sol.resource }),
//   }).then((r) => r.json());
//   const paid = await fetch(`${BASE_URL}/slots`, { headers: { "X-PAYMENT": payment } });
//
// The 200 body and the `X-PAYMENT-RESPONSE` receipt are identical in shape on
// both rails — only `network` and the transaction identifier differ.
//
// ── Raw dual-rail 402, for reference ────────────────────────────────────────
//
//   $ curl -s http://localhost:4022/slots | jq '.accepts[] | {network, payTo, asset}'
//   { "network": "base-sepolia",
//     "payTo": "0x40252CFDF8B20Ed757D61ff157719F33Ec332402",
//     "asset": "0x036CbD53842c5426634e7929541eC2318f3dCF7e" }
//   { "network": "solana",
//     "payTo": "WwwuGbqHrwF5RG89KhUbmRWEvjnRH9k5kVM5p7T3WwW",
//     "asset": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" }
