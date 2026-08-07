import "dotenv/config";
import express from "express";
import { CHECKOUT_PATH, mountSolanaCheckout } from "./checkout.js";
import {
  EVM_NETWORK,
  EVM_PAY_TO,
  SOLANA_NETWORK,
  SOLANA_PAY_TO,
  USING_DEFAULT_PAY_TO,
  paywall,
  railSummary,
  type RouteMap,
} from "./payments.js";
import { ROUTE_SCHEMAS } from "./schemas.js";
import {
  BookingError,
  bookAppointment,
  cancel,
  config,
  getAppointment,
  getSlots,
} from "./service.js";

const PORT = Number(process.env.PORT || 4022);

export const PRICES = {
  slots: "$0.001",
  appointments: "$0.01",
} as const;

/** Paid routes. Anything not listed here is free. */
const routes: RouteMap = {
  "GET /slots": {
    price: PRICES.slots,
    description:
      "Bookable start times for one service or every service, across the booking window",
    // Request/response schemas mirror openapi.json — see src/schemas.ts.
    ...ROUTE_SCHEMAS["GET /slots"],
  },
  "POST /appointments": {
    price: PRICES.appointments,
    description:
      "Book an appointment with a refundable hold. Returns appointmentId, confirmed time, meeting link, cancel policy, cancel token and a base64 ICS calendar invite",
    ...ROUTE_SCHEMAS["POST /appointments"],
  },
};

const app = express();
app.use(express.json());
// A malformed JSON body must not pre-empt the paywall. The x402 discovery spec
// requires a probe to reach the 402 challenge *before* body validation rejects
// the request, so a parse failure drops the body and falls through instead of
// answering 400. The route handler still rejects it once payment verifies, and
// a 4xx from the handler never settles — so a bad body is never charged for.
app.use(
  (
    err: unknown,
    req: express.Request,
    _res: express.Response,
    next: express.NextFunction,
  ): void => {
    if (err instanceof SyntaxError && "body" in err) {
      req.body = {};
      next();
      return;
    }
    next(err);
  },
);
// Solana browser checkout for public/index.html (EVM needs no server help).
const solanaCheckout = await mountSolanaCheckout(app);
app.use(paywall(routes, { baseUrl: process.env.PUBLIC_BASE_URL }));
app.use(
  express.static("public", {
    setHeaders: (res, p) => {
      if (p.endsWith("/.well-known/x402")) res.setHeader("Content-Type", "application/json");
    },
  }),
);

// ---- free routes -----------------------------------------------------------

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "x402-bookable", provider: config.provider.name });
});

app.get("/services", (_req, res) => {
  res.json({
    provider: config.provider,
    hours: config.hours,
    bookingWindowDays: config.bookingWindowDays,
    cancelPolicy: config.cancelPolicy,
    prices: PRICES,
    services: config.services,
    payment: {
      rails: [
        { rail: "evm", network: EVM_NETWORK, asset: "USDC", payTo: EVM_PAY_TO },
        { rail: "solana", network: SOLANA_NETWORK, asset: "USDC", payTo: SOLANA_PAY_TO },
      ],
    },
  });
});

// ---- paid routes (payment enforced by the paywall above) -------------------

app.get("/slots", (req, res) => {
  try {
    res.json(
      getSlots({
        service: typeof req.query.service === "string" ? req.query.service : undefined,
        date: typeof req.query.date === "string" ? req.query.date : undefined,
        days: req.query.days ? Number(req.query.days) : undefined,
      }),
    );
  } catch (err) {
    handleError(err, res);
  }
});

app.post("/appointments", (req, res) => {
  try {
    const payer = req.header("x-payer-address") ?? res.locals.x402?.payer ?? req.body?.payerWallet;
    const confirmation = bookAppointment({ ...req.body, payerWallet: payer });
    // If settlement fails after this point, free the slot again.
    res.locals.x402Rollback = () => {
      try {
        cancel(confirmation.appointmentId, confirmation.cancelToken);
      } catch {
        /* already gone */
      }
    };
    res.json(confirmation);
  } catch (err) {
    handleError(err, res);
  }
});

// ---- free, authenticated by cancelToken ------------------------------------

app.post("/cancel/:id", (req, res) => {
  try {
    const token = req.body?.cancelToken ?? req.header("x-cancel-token") ?? undefined;
    res.json(cancel(req.params.id, token));
  } catch (err) {
    handleError(err, res);
  }
});

app.get("/appointments/:id", (req, res) => {
  try {
    const token =
      (typeof req.query.cancelToken === "string" ? req.query.cancelToken : undefined) ??
      req.header("x-cancel-token") ??
      undefined;
    res.json(getAppointment(req.params.id, token));
  } catch (err) {
    handleError(err, res);
  }
});

function handleError(err: unknown, res: express.Response): void {
  if (err instanceof BookingError) {
    res.status(err.status).json({ error: err.code, message: err.message });
    return;
  }
  console.error(err);
  res.status(500).json({ error: "INTERNAL", message: "unexpected error" });
}

app.listen(PORT, () => {
  console.log(`\n  x402-bookable — ${config.provider.name}`);
  console.log(`  http://localhost:${PORT}\n`);
  console.log("  Paid routes — pay in USDC on Base or Solana, your client picks the rail:");
  console.log(`    GET  /slots             ${PRICES.slots}`);
  console.log(`    POST /appointments      ${PRICES.appointments}  (refundable hold)`);
  console.log("  Free routes:");
  console.log("    GET  /health  /services  /appointments/:id");
  console.log("    POST /cancel/:id        (auth: cancelToken)");
  console.log("");
  for (const line of railSummary()) console.log(`  ${line}`);
  console.log(
    `  Solana browser checkout: ${solanaCheckout ? `mounted at ${CHECKOUT_PATH}` : "disabled"}`,
  );
  if (USING_DEFAULT_PAY_TO) {
    console.log(
      "  NOTE: using suite default payTo — set PAY_TO_ADDRESS / SOLANA_PAY_TO_ADDRESS to receive funds yourself",
    );
  }
  console.log(`  Manifest: http://localhost:${PORT}/.well-known/x402`);
  console.log(`  Demo:     http://localhost:${PORT}/\n`);
});
