import type { VerifyFunction, VerifyResult } from "../types.js";

interface RazorpayVerifierOptions {
  keyId: string;
  keySecret: string;
  baseUrl?: string;
}

interface MandateSetupResult {
  customerId: string;
  tokenId: string;
  email: string;
  contact: string;
}

async function rzpFetch(
  baseUrl: string,
  auth: string,
  path: string,
  body?: unknown,
): Promise<{ ok: boolean; status: number; data: Record<string, unknown> }> {
  const init: RequestInit = {
    method: body ? "POST" : "GET",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/json",
    },
  };
  if (body) init.body = JSON.stringify(body);
  const res = await fetch(`${baseUrl}${path}`, init);
  const data = (await res.json()) as Record<string, unknown>;
  return { ok: res.ok, status: res.status, data };
}

export async function setupMandate(opts: {
  keyId: string;
  keySecret: string;
  baseUrl?: string;
  email?: string;
  contact?: string;
  name?: string;
  vpa?: string;
  maxAmount?: number;
  expireAt?: number;
  frequency?: string;
}): Promise<MandateSetupResult> {
  const baseUrl = opts.baseUrl ?? "https://api.razorpay.com/v1";
  const auth = Buffer.from(`${opts.keyId}:${opts.keySecret}`).toString("base64");
  const email = opts.email ?? "test@upi402.dev";
  const contact = opts.contact ?? "9876543210";
  const maxAmount = opts.maxAmount ?? 500000;
  const expireAt = opts.expireAt ?? Math.floor(Date.now() / 1000) + 86400 * 365;
  const frequency = opts.frequency ?? "as_presented";

  const cust = await rzpFetch(baseUrl, auth, "/customers", {
    name: opts.name ?? "UPI-402 Agent",
    email,
    contact,
    fail_existing: "0",
  });
  if (!cust.ok) {
    throw new Error(`Failed to create customer: ${JSON.stringify(cust.data)}`);
  }
  const customerId = cust.data.id as string;

  const order = await rzpFetch(baseUrl, auth, "/orders", {
    amount: 100,
    currency: "INR",
    method: "upi",
    customer_id: customerId,
    token: { max_amount: maxAmount, expire_at: expireAt, frequency },
    receipt: `mandate_setup_${Date.now()}`,
  });
  if (!order.ok) {
    throw new Error(`Failed to create order: ${JSON.stringify(order.data)}`);
  }
  const orderId = order.data.id as string;

  const payment = await rzpFetch(baseUrl, auth, "/payments/create/recurring", {
    amount: 100,
    currency: "INR",
    order_id: orderId,
    customer_id: customerId,
    email,
    contact,
    method: "upi",
    upi: { vpa: opts.vpa ?? "success@razorpay" },
    recurring: "1",
  });
  if (!payment.ok) {
    throw new Error(`Failed to create registration payment: ${JSON.stringify(payment.data)}`);
  }

  const tokens = await rzpFetch(baseUrl, auth, `/customers/${customerId}/tokens`);
  if (!tokens.ok) {
    throw new Error(`Failed to fetch tokens: ${JSON.stringify(tokens.data)}`);
  }
  const items = tokens.data.items as Array<Record<string, unknown>>;
  if (!items || items.length === 0) {
    throw new Error("No tokens found after mandate registration");
  }
  const tokenId = items[0]!.id as string;

  return { customerId, tokenId, email, contact };
}

export function razorpayVerifier(opts: RazorpayVerifierOptions): VerifyFunction {
  const baseUrl = opts.baseUrl ?? "https://api.razorpay.com/v1";
  const auth = Buffer.from(`${opts.keyId}:${opts.keySecret}`).toString("base64");

  const mandateStore = new Map<string, MandateSetupResult>();

  const verifier: VerifyFunction & { registerMandate: (umn: string, mandate: MandateSetupResult) => void } =
    async (
      mandateRef: string,
      amount: number,
      txnRef: string,
    ): Promise<VerifyResult> => {
      const mandate = mandateStore.get(mandateRef);
      if (!mandate) {
        return { success: false, error: "mandate_invalid" };
      }

      try {
        const order = await rzpFetch(baseUrl, auth, "/orders", {
          amount: amount * 100,
          currency: "INR",
          receipt: txnRef,
        });
        if (!order.ok) {
          return { success: false, error: `Failed to create order: ${JSON.stringify(order.data)}` };
        }

        const res = await rzpFetch(baseUrl, auth, "/payments/create/recurring", {
          email: mandate.email,
          contact: mandate.contact,
          amount: amount * 100,
          currency: "INR",
          order_id: order.data.id,
          customer_id: mandate.customerId,
          token: mandate.tokenId,
          recurring: "1",
          description: `UPI-402 debit ${txnRef}`,
        });

        if (!res.ok) {
          const errMsg =
            (res.data.error as Record<string, unknown>)?.description as string ??
            `Razorpay error: ${res.status}`;
          return { success: false, error: errMsg };
        }

        return {
          success: true,
          txnId: res.data.razorpay_payment_id as string,
          receipt: res.data,
        };
      } catch (err) {
        return {
          success: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    };

  verifier.registerMandate = (umn: string, mandate: MandateSetupResult) => {
    mandateStore.set(umn, mandate);
  };

  return verifier;
}
