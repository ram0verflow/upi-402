// UNTESTED — built from Cashfree documentation.
// https://www.cashfree.com/docs/payments/upi-reserve-pay/
// PRs with real-credential testing welcome.

import type { VerifyFunction, VerifyResult } from "../types.js";

interface CashfreeVerifierOptions {
  appId: string;
  secretKey: string;
  baseUrl?: string;
}

export function cashfreeVerifier(opts: CashfreeVerifierOptions): VerifyFunction {
  const baseUrl = opts.baseUrl ?? "https://api.cashfree.com/pg";

  return async (
    mandateRef: string,
    amount: number,
    txnRef: string,
  ): Promise<VerifyResult> => {
    try {
      const res = await fetch(`${baseUrl}/subscriptions/${mandateRef}/charge`, {
        method: "POST",
        headers: {
          "x-client-id": opts.appId,
          "x-client-secret": opts.secretKey,
          "Content-Type": "application/json",
          "x-api-version": "2023-08-01",
        },
        body: JSON.stringify({
          charge_amount: amount,
          charge_note: `UPI-402 debit ${txnRef}`,
          idempotency_key: txnRef,
        }),
      });

      const data = (await res.json()) as Record<string, unknown>;

      if (res.ok && data.cf_charge_id) {
        return {
          success: true,
          txnId: data.cf_charge_id as string,
          receipt: data,
        };
      }

      return {
        success: false,
        error: (data.message as string) ?? `Cashfree error: ${res.status}`,
      };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  };
}
