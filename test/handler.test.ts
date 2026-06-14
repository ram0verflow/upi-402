import { describe, it, expect } from "vitest";
import { createHandler } from "../src/handler.js";
import { generateKeyPair, signPayment } from "../src/signing.js";

describe("handler (framework-agnostic)", () => {
  it("returns 402 when no authorization header", async () => {
    const handle = createHandler({ vpa: "m@y", amount: 100 });
    const result = await handle({ headers: {} });
    expect(result.status).toBe(402);
    expect(result.proceed).toBe(false);
    expect((result.body as Record<string, unknown>).upi402).toBe(1);
    expect(result.headers["X-UPI-402-Version"]).toBe("1");
  });

  it("returns 200 + receipt for valid unsigned mandate", async () => {
    const handle = createHandler({ vpa: "m@y", amount: 100 });
    const result = await handle({
      headers: { authorization: "UPI-Mandate umn=TEST&txnRef=TX1" },
    });
    expect(result.status).toBe(200);
    expect(result.proceed).toBe(true);
    expect(result.receipt).toBeTruthy();
    expect(result.receipt!.amount).toBe(100);
    expect(result.receipt!.mock).toBe(true);
    expect(result.headers["X-UPI-402-Receipt"]).toBeTruthy();
  });

  it("returns 402 with paymentId for signing", async () => {
    const handle = createHandler({ vpa: "m@y", amount: 50 });
    const result = await handle({ headers: {} });
    expect(result.status).toBe(402);
    const body = result.body as Record<string, unknown>;
    expect(body.paymentId).toBeTruthy();
    expect(typeof body.paymentId).toBe("string");
  });

  it("full signed flow: 402 → sign → 200", async () => {
    const handle = createHandler({ vpa: "m@y", amount: 200 });

    const first = await handle({ headers: {} });
    expect(first.status).toBe(402);
    const paymentId = (first.body as Record<string, unknown>).paymentId as string;

    const kp = generateKeyPair();
    const ts = Math.floor(Date.now() / 1000);
    const sig = signPayment(kp.privateKey, paymentId, 200, "m@y", ts);
    const auth = `UPI-Mandate umn=M1&txnRef=TX1&paymentId=${paymentId}&amount=200&ts=${ts}&pub=${encodeURIComponent(kp.publicKey)}&sig=${encodeURIComponent(sig)}`;

    const second = await handle({ headers: { authorization: auth } });
    expect(second.status).toBe(200);
    expect(second.proceed).toBe(true);
    expect(second.receipt!.amount).toBe(200);
  });

  it("uses custom verifier", async () => {
    const handle = createHandler({
      vpa: "m@y",
      amount: 10,
      verify: async () => ({ success: true, txnId: "CUSTOM-001" }),
    });

    const result = await handle({
      headers: { authorization: "UPI-Mandate umn=M1&txnRef=TX1" },
    });
    expect(result.status).toBe(200);
    expect(result.receipt!.txnId).toBe("CUSTOM-001");
  });
});
