import { randomUUID } from "node:crypto";
import type { Request, Response, NextFunction } from "express";
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

declare global {
  namespace Express {
    interface Request {
      upi402?: { receipt: UPI402Receipt };
    }
  }
}

export function upi402(opts: UPI402MiddlewareOptions) {
  const verify = opts.verify ?? mockVerifier();
  const store: PaymentIdStore = opts.store ?? new MemoryStore();

  return async (req: Request, res: Response, next: NextFunction) => {
    const auth = req.headers["authorization"];
    if (!auth) {
      return send402(res, opts, store);
    }

    const parsed = parseMandateAuth(auth);
    if (!parsed) {
      return send402(res, opts, store);
    }

    if (opts.requireSignature && !parsed.sig) {
      return send402(res, opts, store, "signature_required");
    }

    let debitAmount = opts.amount;

    if (parsed.sig && parsed.pub && parsed.paymentId && parsed.amount && parsed.ts) {
      const signedAmount = Number(parsed.amount);
      const timestamp = Number(parsed.ts);

      const now = Math.floor(Date.now() / 1000);
      if (Math.abs(now - timestamp) > MAX_AGE_SECONDS) {
        return send402(res, opts, store, "timestamp_expired");
      }

      const consumed = await store.consume(parsed.paymentId);
      if (!consumed) {
        return send402(res, opts, store, "payment_id_invalid");
      }

      const valid = verifyPayment(
        parsed.pub,
        parsed.sig,
        parsed.paymentId,
        signedAmount,
        opts.vpa,
        timestamp,
      );

      if (!valid) {
        return send402(res, opts, store, "signature_invalid");
      }

      if (signedAmount !== opts.amount) {
        return send402(res, opts, store, "amount_mismatch");
      }

      debitAmount = signedAmount;
    }

    try {
      const result = await verify(parsed.umn, debitAmount, parsed.txnRef);

      if (!result.success) {
        return send402(res, opts, store, "debit_failed");
      }

      const receipt =
        result.receipt && (result.receipt as Record<string, unknown>).mock
          ? (result.receipt as unknown as UPI402Receipt)
          : result.txnId
            ? createReceipt(result.txnId, parsed.umn, debitAmount, opts.currency ?? "INR")
            : createMockReceipt(parsed.umn, debitAmount, opts.currency ?? "INR");

      req.upi402 = { receipt };
      res.setHeader("X-UPI-402-Receipt", JSON.stringify(receipt));
      next();
    } catch (err) {
      console.error("upi-402 verifier error:", err);
      return send402(res, opts, store, "debit_failed");
    }
  };
}

async function send402(
  res: Response,
  opts: UPI402MiddlewareOptions,
  store: PaymentIdStore,
  error?: string,
) {
  const paymentId = randomUUID();
  await store.issue(paymentId);

  const body = {
    upi402: UPI_402_VERSION,
    paymentId,
    payee: {
      vpa: opts.vpa,
      name: opts.name ?? opts.vpa,
    },
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

  res.setHeader("X-UPI-402-Version", String(UPI_402_VERSION));
  if (error) res.setHeader("X-UPI-402-Error", error);
  res.status(402).json(body);
}
