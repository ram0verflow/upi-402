import { describe, it, expect } from "vitest";
import express from "express";
import { upi402 } from "../src/middleware.js";
import { upi402Fetch } from "../src/client.js";
import { MemoryStore } from "../src/store.js";
import { mockVerifier } from "../src/verifiers/mock.js";

async function listen(app: express.Express) {
  return new Promise<{ port: number; close: () => void }>((resolve) => {
    const server = app.listen(0, () => {
      resolve({ port: (server.address() as { port: number }).port, close: () => server.close() });
    });
  });
}

describe("PaymentIdStore status()", () => {
  it("returns 'issued' after issue()", async () => {
    const store = new MemoryStore();
    await store.issue("id-a");
    expect(await store.status("id-a")).toBe("issued");
    store.destroy();
  });

  it("returns 'consumed' after consume()", async () => {
    const store = new MemoryStore();
    await store.issue("id-b");
    await store.consume("id-b");
    expect(await store.status("id-b")).toBe("consumed");
    store.destroy();
  });

  it("returns 'unknown' for non-existent id", async () => {
    const store = new MemoryStore();
    expect(await store.status("no-such-id")).toBe("unknown");
    store.destroy();
  });

  it("returns 'unknown' for expired id", async () => {
    const store = new MemoryStore(50);
    await store.issue("short");
    await new Promise((r) => setTimeout(r, 100));
    expect(await store.status("short")).toBe("unknown");
    store.destroy();
  });
});

describe("202 pending flow", () => {
  it("verifier returns pending then success — client gets 202 then 200", async () => {
    const app = express();
    app.get(
      "/api/data",
      upi402({
        vpa: "m@y",
        amount: 100,
        verify: mockVerifier({ simulatePending: true }),
      }),
      (_req, res) => res.json({ data: "unlocked" }),
    );

    const { port, close } = await listen(app);

    const res = await upi402Fetch(`http://127.0.0.1:${port}/api/data`, {
      mandateRef: "M-PENDING",
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: string };
    expect(body.data).toBe("unlocked");
    close();
  }, 30000);

  it("202 response includes retryAfter and paymentId", async () => {
    const app = express();
    app.get(
      "/api/data",
      upi402({
        vpa: "m@y",
        amount: 100,
        verify: mockVerifier({ simulatePending: true }),
      }),
      (_req, res) => res.json({ ok: true }),
    );

    const { port, close } = await listen(app);

    // Get 402 first
    const res402 = await fetch(`http://127.0.0.1:${port}/api/data`);
    expect(res402.status).toBe(402);

    // Send unsigned request — verifier returns pending on first call
    const res202 = await fetch(`http://127.0.0.1:${port}/api/data`, {
      headers: { Authorization: "UPI-Mandate umn=M1&txnRef=TX1" },
    });
    expect(res202.status).toBe(202);
    const pending = (await res202.json()) as { status: string; retryAfter: number };
    expect(pending.status).toBe("payment_pending");
    expect(pending.retryAfter).toBe(5);

    close();
  });

  it("client does not generate new paymentId when polling 202", async () => {
    const paymentIds = new Set<string>();

    const app = express();
    app.get(
      "/api/data",
      upi402({
        vpa: "m@y",
        amount: 100,
        verify: mockVerifier({ simulatePending: true }),
      }),
      (req, res) => {
        res.json({ ok: true });
      },
    );

    // Intercept to track paymentIds in Authorization headers
    const origApp = express();
    origApp.use((req, _res, next) => {
      const auth = req.headers["authorization"];
      if (auth) {
        const match = auth.match(/paymentId=([^&]+)/);
        if (match) paymentIds.add(match[1]!);
      }
      next();
    });

    const wrappedApp = express();
    wrappedApp.use(origApp);
    wrappedApp.get(
      "/api/data",
      upi402({
        vpa: "m@y",
        amount: 100,
        verify: mockVerifier({ simulatePending: true }),
      }),
      (_req, res) => res.json({ ok: true }),
    );

    const { port, close } = await listen(wrappedApp);

    await upi402Fetch(`http://127.0.0.1:${port}/api/data`, {
      mandateRef: "M-POLL",
    });

    // All retries should use the same paymentId
    expect(paymentIds.size).toBeLessThanOrEqual(1);
    close();
  }, 30000);
});

describe("drain prevention", () => {
  it("verifier pending does not create new payments on poll", async () => {
    let verifyCallCount = 0;

    const app = express();
    app.get(
      "/api/data",
      upi402({
        vpa: "m@y",
        amount: 100,
        verify: async (_umn, _amount, txnRef) => {
          verifyCallCount++;
          if (verifyCallCount === 1) return { success: false, pending: true };
          return { success: true, txnId: "DONE" };
        },
      }),
      (_req, res) => res.json({ ok: true }),
    );

    const { port, close } = await listen(app);

    const res = await upi402Fetch(`http://127.0.0.1:${port}/api/data`, {
      mandateRef: "M-DRAIN",
    });

    expect(res.status).toBe(200);
    // Verify was called exactly twice: once pending, once success
    expect(verifyCallCount).toBe(2);
    close();
  }, 30000);
});
