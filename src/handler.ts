import { randomUUID } from "node:crypto";
import {
  UPI_402_VERSION,
  type UPI402MiddlewareOptions,
  type UPI402Receipt,
} from "./types.js";
import { parseMandateAuth } from "./parse.js";
import { mockVerifier } from "./verifiers/mock.js";
import { createReceipt, createMockReceipt } from "./receipt.js";
import { verifyPayment } from "./signing.js";
import { MemoryStore, type PaymentIdStore } from "./store.js";

const MAX_AGE_SECONDS = 300;

export interface UPI402Request {
  headers: Record<string, string | undefined>;
}

export interface UPI402Result {
  status: 200 | 202 | 402;
  headers: Record<string, string>;
  body: unknown;
  proceed: boolean;
  receipt?: UPI402Receipt;
}

export type UPI402Options = UPI402MiddlewareOptions;

export function createHandler(opts: UPI402Options) {
  const verify = opts.verify ?? mockVerifier();
  const store: PaymentIdStore = opts.store ?? new MemoryStore();

  function make402(error?: string): UPI402Result {
    const paymentId = randomUUID();
    store.issue(paymentId);

    const headers: Record<string, string> = {
      "X-UPI-402-Version": String(UPI_402_VERSION),
    };
    if (error) headers["X-UPI-402-Error"] = error;

    return {
      status: 402,
      headers,
      body: {
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
      },
      proceed: false,
    };
  }

  function make200(
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
      status: 200,
      headers: { "X-UPI-402-Receipt": JSON.stringify(receipt) },
      body: null,
      proceed: true,
      receipt,
    };
  }

  function make202(paymentId?: string): UPI402Result {
    return {
      status: 202,
      headers: {},
      body: { status: "payment_pending", paymentId, retryAfter: 5 },
      proceed: false,
    };
  }

  return async function handleUPI402(request: UPI402Request): Promise<UPI402Result> {
    const auth = request.headers["authorization"];
    if (!auth) return make402();

    const parsed = parseMandateAuth(auth);
    if (!parsed) return make402();

    if (opts.requireSignature && !parsed.sig) {
      return make402("signature_required");
    }

    const hasSig = parsed.sig && parsed.pub && parsed.paymentId && parsed.amount && parsed.ts;

    if (hasSig) {
      const state = await store.status(parsed.paymentId!);

      if (state === "unknown") return make402("payment_id_invalid");

      if (state === "consumed") {
        try {
          const result = await verify(parsed.umn, opts.amount, parsed.txnRef);
          if (result.pending) return make202(parsed.paymentId);
          if (result.success) return make200(parsed.umn, opts.amount, result);
          return make402("debit_failed");
        } catch (err) {
          console.error("[upi-402]", err);
          return make402("debit_failed");
        }
      }

      const signedAmount = Number(parsed.amount);
      const timestamp = Number(parsed.ts);

      const now = Math.floor(Date.now() / 1000);
      if (Math.abs(now - timestamp) > MAX_AGE_SECONDS) {
        return make402("timestamp_expired");
      }

      const consumed = await store.consume(parsed.paymentId!);
      if (!consumed) return make402("payment_id_invalid");

      const valid = verifyPayment(
        parsed.pub!,
        parsed.sig!,
        parsed.paymentId!,
        signedAmount,
        opts.vpa,
        timestamp,
      );

      if (!valid) return make402("signature_invalid");
      if (signedAmount !== opts.amount) return make402("amount_mismatch");

      try {
        const result = await verify(parsed.umn, signedAmount, parsed.txnRef);
        if (result.pending) return make202(parsed.paymentId);
        if (!result.success) return make402("debit_failed");
        return make200(parsed.umn, signedAmount, result);
      } catch (err) {
        console.error("[upi-402]", err);
        return make402("debit_failed");
      }
    }

    try {
      const result = await verify(parsed.umn, opts.amount, parsed.txnRef);
      if (result.pending) return make202();
      if (!result.success) return make402("debit_failed");
      return make200(parsed.umn, opts.amount, result);
    } catch (err) {
      console.error("[upi-402]", err);
      return make402("debit_failed");
    }
  };
}
