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

  function send402(res: Response, error?: string) {
    const paymentId = randomUUID();
    store.issue(paymentId);

    const body = {
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

    res.setHeader("X-UPI-402-Version", String(UPI_402_VERSION));
    if (error) res.setHeader("X-UPI-402-Error", error);
    res.status(402).json(body);
  }

  function sendReceipt(
    req: Request,
    res: Response,
    next: NextFunction,
    umn: string,
    debitAmount: number,
    result: { txnId?: string; receipt?: Record<string, unknown> },
  ) {
    const receipt =
      result.receipt && (result.receipt as Record<string, unknown>).mock
        ? (result.receipt as unknown as UPI402Receipt)
        : result.txnId
          ? createReceipt(result.txnId, umn, debitAmount, opts.currency ?? "INR")
          : createMockReceipt(umn, debitAmount, opts.currency ?? "INR");

    req.upi402 = { receipt };
    res.setHeader("X-UPI-402-Receipt", JSON.stringify(receipt));
    next();
  }

  return async (req: Request, res: Response, next: NextFunction) => {
    const auth = req.headers["authorization"];
    if (!auth) return send402(res);

    const parsed = parseMandateAuth(auth);
    if (!parsed) return send402(res);

    if (opts.requireSignature && !parsed.sig) {
      return send402(res, "signature_required");
    }

    const hasSig = parsed.sig && parsed.pub && parsed.paymentId && parsed.amount && parsed.ts;

    if (hasSig) {
      const state = await store.status(parsed.paymentId!);

      if (state === "unknown") {
        return send402(res, "payment_id_invalid");
      }

      if (state === "consumed") {
        try {
          const result = await verify(parsed.umn, opts.amount, parsed.txnRef);
          if (result.pending) {
            res.status(202).json({
              status: "payment_pending",
              paymentId: parsed.paymentId,
              retryAfter: 5,
            });
            return;
          }
          if (result.success) {
            return sendReceipt(req, res, next, parsed.umn, opts.amount, result);
          }
          return send402(res, "debit_failed");
        } catch (err) {
          console.error("[upi-402]", err);
          return send402(res, "debit_failed");
        }
      }

      const signedAmount = Number(parsed.amount);
      const timestamp = Number(parsed.ts);

      const now = Math.floor(Date.now() / 1000);
      if (Math.abs(now - timestamp) > MAX_AGE_SECONDS) {
        return send402(res, "timestamp_expired");
      }

      const consumed = await store.consume(parsed.paymentId!);
      if (!consumed) {
        return send402(res, "payment_id_invalid");
      }

      const valid = verifyPayment(
        parsed.pub!,
        parsed.sig!,
        parsed.paymentId!,
        signedAmount,
        opts.vpa,
        timestamp,
      );

      if (!valid) {
        return send402(res, "signature_invalid");
      }

      if (signedAmount !== opts.amount) {
        return send402(res, "amount_mismatch");
      }

      try {
        const result = await verify(parsed.umn, signedAmount, parsed.txnRef);

        if (result.pending) {
          res.status(202).json({
            status: "payment_pending",
            paymentId: parsed.paymentId,
            retryAfter: 5,
          });
          return;
        }

        if (!result.success) {
          return send402(res, "debit_failed");
        }

        return sendReceipt(req, res, next, parsed.umn, signedAmount, result);
      } catch (err) {
        console.error("[upi-402]", err);
        return send402(res, "debit_failed");
      }
    }

    // Unsigned flow
    try {
      const result = await verify(parsed.umn, opts.amount, parsed.txnRef);

      if (result.pending) {
        res.status(202).json({
          status: "payment_pending",
          retryAfter: 5,
        });
        return;
      }

      if (!result.success) {
        return send402(res, "debit_failed");
      }

      return sendReceipt(req, res, next, parsed.umn, opts.amount, result);
    } catch (err) {
      console.error("[upi-402]", err);
      return send402(res, "debit_failed");
    }
  };
}
