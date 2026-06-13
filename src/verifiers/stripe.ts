// UNTESTED — built from Stripe documentation.
// https://docs.stripe.com/payments/upi/upi-autopay
// PRs with real-credential testing welcome.

import type { VerifyFunction, VerifyResult } from "../types.js";

interface StripeVerifierOptions {
  secretKey: string;
  baseUrl?: string;
}

export function stripeVerifier(opts: StripeVerifierOptions): VerifyFunction {
  const baseUrl = opts.baseUrl ?? "https://api.stripe.com/v1";
  const auth = Buffer.from(`${opts.secretKey}:`).toString("base64");

  return async (
    mandateRef: string,
    amount: number,
    txnRef: string,
  ): Promise<VerifyResult> => {
    try {
      const body = new URLSearchParams({
        amount: String(amount * 100),
        currency: "inr",
        payment_method: mandateRef,
        confirm: "true",
        mandate: mandateRef,
        "metadata[txn_ref]": txnRef,
        "metadata[source]": "upi-402",
      });

      const res = await fetch(`${baseUrl}/payment_intents`, {
        method: "POST",
        headers: {
          Authorization: `Basic ${auth}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: body.toString(),
      });

      const data = (await res.json()) as Record<string, unknown>;

      if (data.status === "succeeded") {
        return {
          success: true,
          txnId: data.id as string,
          receipt: data,
        };
      }

      return {
        success: false,
        error: ((data.error as Record<string, unknown>)?.message as string) ?? `Stripe error: ${data.status}`,
      };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  };
}
