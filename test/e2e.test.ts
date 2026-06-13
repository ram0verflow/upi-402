import { describe, it, expect } from "vitest";
import express from "express";
import { upi402 } from "../src/middleware.js";
import { upi402Fetch } from "../src/client.js";

describe("e2e: full 402 → retry → 200 flow", () => {
  it("client gets 402, retries with mandate, gets 200 + receipt", async () => {
    const app = express();
    app.get(
      "/api/secret",
      upi402({ vpa: "merchant@ybl", amount: 500, description: "API access" }),
      (_req, res) => {
        res.json({
          secret: "The Times 03/Jan/2009",
          receipt: _req.upi402?.receipt,
        });
      },
    );

    const server = app.listen(0);
    const addr = server.address() as { port: number };
    const url = `http://127.0.0.1:${addr.port}/api/secret`;

    let paymentRequiredCalled = false;
    let paymentCompleteCalled = false;

    const res = await upi402Fetch(url, {
      mandateRef: "MANDATE-TEST-001",
      onPaymentRequired: (details) => {
        paymentRequiredCalled = true;
        expect(details.payee.vpa).toBe("merchant@ybl");
        expect(details.payment.amount).toBe(500);
      },
      onPaymentComplete: (receipt) => {
        paymentCompleteCalled = true;
        expect(receipt.amount).toBe(500);
        expect(receipt.umn).toBe("MANDATE-TEST-001");
        expect(receipt.mock).toBe(true);
      },
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.secret).toBe("The Times 03/Jan/2009");
    expect(paymentRequiredCalled).toBe(true);
    expect(paymentCompleteCalled).toBe(true);
    expect(res.upi402Receipt).toBeTruthy();
    expect(res.upi402Receipt!.mock).toBe(true);

    server.close();
  });

  it("client throws UPI402PaymentError when verify fails", async () => {
    const app = express();
    app.get(
      "/api/fail",
      upi402({
        vpa: "m@y",
        amount: 100,
        verify: async () => ({ success: false, error: "mandate_expired" }),
      }),
      (_req, res) => {
        res.json({ ok: true });
      },
    );

    const server = app.listen(0);
    const addr = server.address() as { port: number };
    const url = `http://127.0.0.1:${addr.port}/api/fail`;

    await expect(
      upi402Fetch(url, { mandateRef: "EXPIRED-001" }),
    ).rejects.toThrow("Payment failed");

    server.close();
  });

  it("client passes through non-402 responses", async () => {
    const app = express();
    app.get("/api/free", (_req, res) => {
      res.json({ free: true });
    });

    const server = app.listen(0);
    const addr = server.address() as { port: number };
    const url = `http://127.0.0.1:${addr.port}/api/free`;

    const res = await upi402Fetch(url, { mandateRef: "UNUSED" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.free).toBe(true);
    expect(res.upi402Receipt).toBeUndefined();

    server.close();
  });
});
