// UNTESTED — built from PhonePe documentation.
// https://developer.phonepe.com/v1/docs/system-flow-recurring
// PRs with real-credential testing welcome.

import type { VerifyFunction, VerifyResult } from "../types.js";

interface PhonePeVerifierOptions {
  merchantId: string;
  saltKey: string;
  saltIndex?: number;
  baseUrl?: string;
}

export function phonepeVerifier(opts: PhonePeVerifierOptions): VerifyFunction {
  const baseUrl = opts.baseUrl ?? "https://api.phonepe.com/apis/hermes";

  return async (
    mandateRef: string,
    amount: number,
    txnRef: string,
  ): Promise<VerifyResult> => {
    try {
      const payload = {
        merchantId: opts.merchantId,
        merchantTransactionId: txnRef,
        subscriptionId: mandateRef,
        amount: amount * 100,
      };

      const payloadBase64 = Buffer.from(JSON.stringify(payload)).toString("base64");

      const res = await fetch(`${baseUrl}/pg/v1/recurring/debit/execute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ request: payloadBase64 }),
      });

      const data = (await res.json()) as Record<string, unknown>;

      if (data.success) {
        return {
          success: true,
          txnId: (data.data as Record<string, unknown>)?.transactionId as string,
          receipt: data,
        };
      }

      return {
        success: false,
        error: (data.message as string) ?? "PhonePe debit failed",
      };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  };
}
