import { randomUUID } from "node:crypto";
import {
  UPI_402_VERSION,
  type UPI402Receipt,
  type VerifyFunction,
  type MandateFrequency,
} from "./types.js";
import type { PaymentIdStore } from "./store.js";
import { parseMandateAuth } from "./parse.js";
import { mockVerifier } from "./verifiers/mock.js";
import { createReceipt, createMockReceipt } from "./receipt.js";
import { verifyPayment } from "./signing.js";
import { MemoryStore } from "./store.js";

const MAX_AGE_SECONDS = 300;

export interface UPI402Options {
  vpa: string;
  amount: number;
  currency?: string;
  name?: string;
  description?: string;
  verify?: VerifyFunction;
  store?: PaymentIdStore;
  requireSignature?: boolean;
  mandate?: {
    required?: boolean;
    maxAmount?: number;
    frequency?: MandateFrequency;
    validUntil?: string;
    setupUrl?: string;
  };
}

export type UPI402Action =
  | "payment_required"
  | "payment_pending"
  | "payment_confirmed"
  | "payment_failed";

export interface UPI402Result {
  action: UPI402Action;
  response?: Response;
  receipt?: UPI402Receipt;
  paymentId?: string;
  error?: string;
}

export async function handleUPI402(
  request: Request,
  opts: UPI402Options,
): Promise<UPI402Result> {
  const verify = opts.verify ?? mockVerifier();
  const store: PaymentIdStore = opts.store ?? defaultStore(opts);

  const auth = request.headers.get("authorization");
  if (!auth) return make402(opts, store);

  const parsed = parseMandateAuth(auth);
  if (!parsed) return make402(opts, store);

  if (opts.requireSignature && !parsed.sig) {
    return make402(opts, store, "signature_required");
  }

  const hasSig = parsed.sig && parsed.pub && parsed.paymentId && parsed.amount && parsed.ts;

  if (hasSig) {
    const state = await store.status(parsed.paymentId!);

    if (state === "unknown") return make402(opts, store, "payment_id_invalid");

    if (state === "consumed") {
      try {
        const result = await verify(parsed.umn, opts.amount, parsed.txnRef);
        if (result.pending) return make202(parsed.paymentId);
        if (result.success) return makeConfirmed(opts, parsed.umn, opts.amount, result);
        return makeFailed("debit_failed");
      } catch (err) {
        console.error("[upi-402]", err);
        return makeFailed("debit_failed");
      }
    }

    const signedAmount = Number(parsed.amount);
    const timestamp = Number(parsed.ts);

    const now = Math.floor(Date.now() / 1000);
    if (Math.abs(now - timestamp) > MAX_AGE_SECONDS) {
      return make402(opts, store, "timestamp_expired");
    }

    const consumed = await store.consume(parsed.paymentId!);
    if (!consumed) return make402(opts, store, "payment_id_invalid");

    const valid = verifyPayment(
      parsed.pub!,
      parsed.sig!,
      parsed.paymentId!,
      signedAmount,
      opts.vpa,
      timestamp,
    );

    if (!valid) return make402(opts, store, "signature_invalid");
    if (signedAmount !== opts.amount) return make402(opts, store, "amount_mismatch");

    try {
      const result = await verify(parsed.umn, signedAmount, parsed.txnRef);
      if (result.pending) return make202(parsed.paymentId);
      if (!result.success) return makeFailed("debit_failed");
      return makeConfirmed(opts, parsed.umn, signedAmount, result);
    } catch (err) {
      console.error("[upi-402]", err);
      return makeFailed("debit_failed");
    }
  }

  try {
    const result = await verify(parsed.umn, opts.amount, parsed.txnRef);
    if (result.pending) return make202();
    if (!result.success) return makeFailed("debit_failed");
    return makeConfirmed(opts, parsed.umn, opts.amount, result);
  } catch (err) {
    console.error("[upi-402]", err);
    return makeFailed("debit_failed");
  }
}

const storeCache = new WeakMap<object, PaymentIdStore>();
function defaultStore(opts: UPI402Options): PaymentIdStore {
  if (opts.store) return opts.store;
  let s = storeCache.get(opts);
  if (!s) { s = new MemoryStore(); storeCache.set(opts, s); }
  return s;
}

function build402Body(opts: UPI402Options, paymentId: string, error?: string) {
  return {
    upi402: UPI_402_VERSION,
    paymentId,
    payee: { vpa: opts.vpa, name: opts.name ?? opts.vpa },
    payment: {
      amount: opts.amount,
      currency: opts.currency ?? "INR",
      description: opts.description,
    },
    mandate: opts.mandate
      ? {
          required: opts.mandate.required ?? true,
          maxAmount: opts.mandate.maxAmount,
          frequency: opts.mandate.frequency,
          validUntil: opts.mandate.validUntil,
          setupUrl: opts.mandate.setupUrl,
        }
      : { required: true },
    ...(error && { error }),
  };
}

function make402(opts: UPI402Options, store: PaymentIdStore, error?: string): UPI402Result {
  const paymentId = randomUUID();
  store.issue(paymentId);

  const headers = new Headers({
    "Content-Type": "application/json",
    "X-UPI-402-Version": String(UPI_402_VERSION),
  });
  if (error) headers.set("X-UPI-402-Error", error);

  return {
    action: "payment_required",
    response: new Response(JSON.stringify(build402Body(opts, paymentId, error)), {
      status: 402,
      headers,
    }),
    paymentId,
    error,
  };
}

function make202(paymentId?: string): UPI402Result {
  return {
    action: "payment_pending",
    response: new Response(
      JSON.stringify({ status: "payment_pending", paymentId, retryAfter: 5 }),
      { status: 202, headers: { "Content-Type": "application/json" } },
    ),
    paymentId,
  };
}

function makeConfirmed(
  opts: UPI402Options,
  umn: string,
  debitAmount: number,
  result: { txnId?: string; receipt?: Record<string, unknown> },
): UPI402Result {
  const receipt =
    result.receipt && (result.receipt as Record<string, unknown>).mock
      ? (result.receipt as unknown as UPI402Receipt)
      : result.txnId
        ? createReceipt(result.txnId, umn, debitAmount, opts.currency ?? "INR")
        : createMockReceipt(umn, debitAmount, opts.currency ?? "INR");

  return {
    action: "payment_confirmed",
    receipt,
  };
}

function makeFailed(error: string): UPI402Result {
  return {
    action: "payment_failed",
    response: new Response(JSON.stringify({ error }), {
      status: 402,
      headers: {
        "Content-Type": "application/json",
        "X-UPI-402-Error": error,
      },
    }),
    error,
  };
}
