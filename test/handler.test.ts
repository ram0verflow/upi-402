import { describe, it, expect } from "vitest";
import { handleUPI402 } from "../src/handler.js";
import { generateKeyPair, signPayment } from "../src/signing.js";
import { MemoryStore } from "../src/store.js";

function req(headers?: Record<string, string>): Request {
  return new Request("http://localhost/api/data", { headers });
}

describe("handleUPI402 (Web Standard Request)", () => {
  it("returns payment_required when no authorization", async () => {
    const store = new MemoryStore();
    const result = await handleUPI402(req(), { vpa: "m@y", amount: 100, store });
    expect(result.action).toBe("payment_required");
    expect(result.response).toBeTruthy();
    expect(result.response!.status).toBe(402);
    const body = await result.response!.json();
    expect(body.upi402).toBe(1);
    expect(body.paymentId).toBeTruthy();
    expect(body.payee.vpa).toBe("m@y");
    expect(body.payment.amount).toBe(100);
    store.destroy();
  });

  it("returns payment_confirmed for valid unsigned mandate (mock)", async () => {
    const store = new MemoryStore();
    const result = await handleUPI402(
      req({ authorization: "UPI-Mandate umn=TEST&txnRef=TX1" }),
      { vpa: "m@y", amount: 100, store },
    );
    expect(result.action).toBe("payment_confirmed");
    expect(result.response).toBeUndefined();
    expect(result.receipt).toBeTruthy();
    expect(result.receipt!.amount).toBe(100);
    expect(result.receipt!.mock).toBe(true);
    store.destroy();
  });

  it("returns paymentId in 402 body for signing", async () => {
    const store = new MemoryStore();
    const result = await handleUPI402(req(), { vpa: "m@y", amount: 50, store });
    expect(result.action).toBe("payment_required");
    expect(result.paymentId).toBeTruthy();
    const body = await result.response!.json();
    expect(body.paymentId).toBe(result.paymentId);
    store.destroy();
  });

  it("full signed flow: 402 then sign then confirmed", async () => {
    const store = new MemoryStore();
    const opts = { vpa: "m@y", amount: 200, store };

    const first = await handleUPI402(req(), opts);
    expect(first.action).toBe("payment_required");
    const paymentId = first.paymentId!;

    const kp = generateKeyPair();
    const ts = Math.floor(Date.now() / 1000);
    const sig = signPayment(kp.privateKey, paymentId, 200, "m@y", ts);
    const auth = `UPI-Mandate umn=M1&txnRef=TX1&paymentId=${paymentId}&amount=200&ts=${ts}&pub=${encodeURIComponent(kp.publicKey)}&sig=${encodeURIComponent(sig)}`;

    const second = await handleUPI402(req({ authorization: auth }), opts);
    expect(second.action).toBe("payment_confirmed");
    expect(second.receipt!.amount).toBe(200);
    store.destroy();
  });

  it("uses custom verifier", async () => {
    const store = new MemoryStore();
    const result = await handleUPI402(
      req({ authorization: "UPI-Mandate umn=M1&txnRef=TX1" }),
      {
        vpa: "m@y",
        amount: 10,
        store,
        verify: async () => ({ success: true, txnId: "CUSTOM-001" }),
      },
    );
    expect(result.action).toBe("payment_confirmed");
    expect(result.receipt!.txnId).toBe("CUSTOM-001");
    store.destroy();
  });

  it("returns payment_failed when verifier fails", async () => {
    const store = new MemoryStore();
    const result = await handleUPI402(
      req({ authorization: "UPI-Mandate umn=M1&txnRef=TX1" }),
      {
        vpa: "m@y",
        amount: 10,
        store,
        verify: async () => ({ success: false, error: "insufficient_funds" }),
      },
    );
    expect(result.action).toBe("payment_failed");
    expect(result.response!.status).toBe(402);
    const body = await result.response!.json();
    expect(body.error).toBe("debit_failed");
    store.destroy();
  });

  it("returns payment_pending for pending verifier", async () => {
    const store = new MemoryStore();
    const result = await handleUPI402(
      req({ authorization: "UPI-Mandate umn=M1&txnRef=TX1" }),
      {
        vpa: "m@y",
        amount: 10,
        store,
        verify: async () => ({ success: false, pending: true }),
      },
    );
    expect(result.action).toBe("payment_pending");
    expect(result.response!.status).toBe(202);
    store.destroy();
  });
});
