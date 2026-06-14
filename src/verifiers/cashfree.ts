import type { VerifyFunction, VerifyResult } from "../types.js";

interface CashfreeVerifierOptions {
  clientId: string;
  clientSecret: string;
  cfSubscriptionId: string;
  baseUrl?: string;
  apiVersion?: string;
}

export function cashfreeVerifier(opts: CashfreeVerifierOptions): VerifyFunction {
  const baseUrl = opts.baseUrl ?? "https://sandbox.cashfree.com";
  const pgHeaders = {
    "x-client-id": opts.clientId,
    "x-client-secret": opts.clientSecret,
    "x-api-version": opts.apiVersion ?? "2023-08-01",
    "Content-Type": "application/json",
  };
  const v2Headers = {
    "X-Client-Id": opts.clientId,
    "X-Client-Secret": opts.clientSecret,
    "Content-Type": "application/json",
  };

  const inflight = new Map<string, { paymentId: number; status: string }>();

  return async (
    mandateRef: string,
    amount: number,
    txnRef: string,
  ): Promise<VerifyResult> => {
    const existing = inflight.get(txnRef);
    if (existing) {
      const check = await fetch(
        `${baseUrl}/pg/subscriptions/${mandateRef}/payments`,
        { headers: pgHeaders },
      );
      if (check.ok) {
        const payments = (await check.json()) as Array<Record<string, unknown>>;
        const match = payments.find(
          (p) => String(p.cf_payment_id) === String(existing.paymentId),
        );
        if (match) {
          const st = match.payment_status as string;
          if (st === "SUCCESS") {
            inflight.delete(txnRef);
            return { success: true, txnId: String(existing.paymentId), receipt: match };
          }
          if (st === "FAILED") {
            inflight.delete(txnRef);
            return { success: false, error: (match.failure_details as Record<string, unknown>)?.failure_reason as string ?? "charge failed" };
          }
        }
      }
      return { success: false, pending: true, txnId: String(existing.paymentId) };
    }

    try {
      const tomorrow = new Date(Date.now() + 86400000).toISOString().split("T")[0];

      const res = await fetch(
        `${baseUrl}/api/v2/subscriptions/${opts.cfSubscriptionId}/charge`,
        {
          method: "POST",
          headers: v2Headers,
          body: JSON.stringify({
            amount,
            scheduledOn: tomorrow,
            paymentRemarks: `upi-402 ${txnRef}`,
          }),
        },
      );

      const data = (await res.json()) as Record<string, unknown>;

      if (res.ok && data.status === "OK") {
        const payment = data.payment as Record<string, unknown>;
        const paymentId = payment?.paymentId as number;
        const paymentStatus = payment?.status as string;

        inflight.set(txnRef, { paymentId, status: paymentStatus });

        if (paymentStatus === "SUCCESS") {
          inflight.delete(txnRef);
          return { success: true, txnId: String(paymentId), receipt: data };
        }

        return { success: false, pending: true, txnId: String(paymentId) };
      }

      return {
        success: false,
        error: (data.message as string) ?? `Cashfree ${res.status}`,
      };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  };
}
