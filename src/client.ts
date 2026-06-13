import type {
  UPI402FetchOptions,
  UPI402FetchResponse,
  UPI402Response,
  UPI402Receipt,
} from "./types.js";
import { UPI402ResponseSchema } from "./types.js";
import { UPI402PaymentError } from "./errors.js";
import { formatMandateHeader, generateTxnRef } from "./utils.js";
import { parseReceiptHeader } from "./parse.js";

export async function upi402Fetch(
  url: string | URL,
  opts: UPI402FetchOptions & RequestInit,
): Promise<UPI402FetchResponse> {
  const { mandateRef, txnRef, maxRetries = 1, onPaymentRequired, onPaymentComplete, ...fetchOpts } = opts;

  const firstRes = await fetch(url, fetchOpts);

  if (firstRes.status !== 402) {
    return firstRes as UPI402FetchResponse;
  }

  let body: unknown;
  try {
    body = await firstRes.json();
  } catch {
    throw new UPI402PaymentError("Server returned 402 but body is not valid JSON", {
      upi402: 1,
      payee: { vpa: "unknown", name: "unknown" },
      payment: { amount: 0, currency: "INR" },
      error: "invalid_response",
    });
  }

  const parsed = UPI402ResponseSchema.safeParse(body);
  if (!parsed.success) {
    throw new UPI402PaymentError("Server returned 402 but body does not match UPI-402 spec", {
      upi402: 1,
      payee: { vpa: "unknown", name: "unknown" },
      payment: { amount: 0, currency: "INR" },
      error: "invalid_response",
    });
  }

  const details = parsed.data;
  onPaymentRequired?.(details);

  let lastError: UPI402Response = details;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const ref = txnRef ?? generateTxnRef();
    const headers = new Headers(fetchOpts.headers);
    headers.set("Authorization", formatMandateHeader(mandateRef, ref));

    const retryRes = await fetch(url, { ...fetchOpts, headers });

    if (retryRes.status !== 402) {
      const receiptHeader = retryRes.headers.get("X-UPI-402-Receipt");
      const receipt = receiptHeader ? parseReceiptHeader(receiptHeader) : undefined;

      if (receipt) {
        onPaymentComplete?.(receipt);
      }

      const enhanced = retryRes as UPI402FetchResponse;
      enhanced.upi402Receipt = receipt ?? undefined;
      return enhanced;
    }

    try {
      const retryBody = await retryRes.json();
      const retryParsed = UPI402ResponseSchema.safeParse(retryBody);
      if (retryParsed.success) lastError = retryParsed.data;
    } catch {
      // ignore parse failure on retry 402
    }
  }

  throw new UPI402PaymentError(
    `Payment failed after ${maxRetries} attempt(s): ${lastError.error ?? "unknown error"}`,
    lastError,
  );
}

export { UPI402PaymentError } from "./errors.js";
export type { UPI402FetchOptions, UPI402FetchResponse, UPI402Receipt } from "./types.js";
