import { describe, it, expect } from "vitest";
import express from "express";
import { upi402 } from "../src/middleware.js";
import { upi402Fetch } from "../src/client.js";
import { generateKeyPair, signPayment } from "../src/signing.js";

async function listen(app: express.Express): Promise<{ port: number; close: () => void }> {
  return new Promise((resolve) => {
    const server = app.listen(0, () => {
      const addr = server.address() as { port: number };
      resolve({ port: addr.port, close: () => server.close() });
    });
  });
}

describe("payment scoping", () => {
  it("signed e2e flow: client signs, middleware verifies, debit uses signed amount", async () => {
    let debitedAmount: number | null = null;

    const app = express();
    app.get(
      "/api/data",
      upi402({
        vpa: "merchant@ybl",
        amount: 500,
        verify: async (_umn, amount) => {
          debitedAmount = amount;
          return { success: true, txnId: "TXN-SIGNED-001" };
        },
      }),
      (_req, res) => res.json({ ok: true }),
    );

    const { port, close } = await listen(app);
    const res = await upi402Fetch(`http://127.0.0.1:${port}/api/data`, {
      mandateRef: "MANDATE-001",
    });

    expect(res.status).toBe(200);
    expect(debitedAmount).toBe(500);
    expect(res.upi402Receipt).toBeTruthy();
    expect(res.upi402Receipt!.txnId).toBe("TXN-SIGNED-001");
    close();
  });

  it("rejects replayed paymentId", async () => {
    const app = express();
    app.get(
      "/api/data",
      upi402({
        vpa: "m@y",
        amount: 100,
      }),
      (_req, res) => res.json({ ok: true }),
    );

    const { port, close } = await listen(app);

    // First request — get a paymentId
    const first402 = await fetch(`http://127.0.0.1:${port}/api/data`);
    const body = (await first402.json()) as { paymentId: string; payee: { vpa: string }; payment: { amount: number } };
    const paymentId = body.paymentId;

    const kp = generateKeyPair();
    const ts = Math.floor(Date.now() / 1000);
    const sig = signPayment(kp.privateKey, paymentId, 100, "m@y", ts);

    const auth = `UPI-Mandate umn=M1&txnRef=TX1&paymentId=${paymentId}&amount=100&ts=${ts}&pub=${encodeURIComponent(kp.publicKey)}&sig=${encodeURIComponent(sig)}`;

    // First use — should succeed
    const res1 = await fetch(`http://127.0.0.1:${port}/api/data`, {
      headers: { Authorization: auth },
    });
    expect(res1.status).toBe(200);

    // Replay — same paymentId should fail
    const res2 = await fetch(`http://127.0.0.1:${port}/api/data`, {
      headers: { Authorization: auth },
    });
    expect(res2.status).toBe(402);
    const errBody = (await res2.json()) as { error: string };
    expect(errBody.error).toBe("payment_id_invalid");

    close();
  });

  it("rejects invalid signature", async () => {
    const app = express();
    app.get(
      "/api/data",
      upi402({ vpa: "m@y", amount: 100 }),
      (_req, res) => res.json({ ok: true }),
    );

    const { port, close } = await listen(app);

    const first402 = await fetch(`http://127.0.0.1:${port}/api/data`);
    const body = (await first402.json()) as { paymentId: string };

    const freshTs = Math.floor(Date.now() / 1000);
    const auth = `UPI-Mandate umn=M1&txnRef=TX1&paymentId=${body.paymentId}&amount=100&ts=${freshTs}&pub=bogus&sig=bogus`;
    const res = await fetch(`http://127.0.0.1:${port}/api/data`, {
      headers: { Authorization: auth },
    });
    expect(res.status).toBe(402);
    const errBody = (await res.json()) as { error: string };
    expect(errBody.error).toBe("signature_invalid");

    close();
  });

  it("rejects when signed amount does not match server amount", async () => {
    const app = express();
    app.get(
      "/api/data",
      upi402({ vpa: "m@y", amount: 100 }),
      (_req, res) => res.json({ ok: true }),
    );

    const { port, close } = await listen(app);

    const first402 = await fetch(`http://127.0.0.1:${port}/api/data`);
    const body = (await first402.json()) as { paymentId: string };

    const kp = generateKeyPair();
    const ts = Math.floor(Date.now() / 1000);
    // Client signs 50 but server expects 100
    const sig = signPayment(kp.privateKey, body.paymentId, 50, "m@y", ts);
    const auth = `UPI-Mandate umn=M1&txnRef=TX1&paymentId=${body.paymentId}&amount=50&ts=${ts}&pub=${encodeURIComponent(kp.publicKey)}&sig=${encodeURIComponent(sig)}`;

    const res = await fetch(`http://127.0.0.1:${port}/api/data`, {
      headers: { Authorization: auth },
    });
    expect(res.status).toBe(402);
    const errBody = (await res.json()) as { error: string };
    expect(errBody.error).toBe("amount_mismatch");

    close();
  });

  it("requireSignature rejects unsigned requests", async () => {
    const app = express();
    app.get(
      "/api/data",
      upi402({ vpa: "m@y", amount: 100, requireSignature: true }),
      (_req, res) => res.json({ ok: true }),
    );

    const { port, close } = await listen(app);

    const res = await fetch(`http://127.0.0.1:${port}/api/data`, {
      headers: { Authorization: "UPI-Mandate umn=M1&txnRef=TX1" },
    });
    expect(res.status).toBe(402);
    const errBody = (await res.json()) as { error: string };
    expect(errBody.error).toBe("signature_required");

    close();
  });

  it("unsigned requests still work when requireSignature is false (default)", async () => {
    const app = express();
    app.get(
      "/api/data",
      upi402({ vpa: "m@y", amount: 100 }),
      (_req, res) => res.json({ ok: true }),
    );

    const { port, close } = await listen(app);

    const res = await fetch(`http://127.0.0.1:${port}/api/data`, {
      headers: { Authorization: "UPI-Mandate umn=M1&txnRef=TX1" },
    });
    expect(res.status).toBe(200);

    close();
  });
});
