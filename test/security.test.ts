import { describe, it, expect, vi, afterEach } from "vitest";
import express from "express";
import { upi402 } from "../src/middleware.js";
import { MemoryStore, type PaymentIdStore } from "../src/store.js";
import { generateKeyPair, signPayment } from "../src/signing.js";

async function listen(app: express.Express) {
  return new Promise<{ port: number; close: () => void }>((resolve) => {
    const server = app.listen(0, () => {
      resolve({ port: (server.address() as { port: number }).port, close: () => server.close() });
    });
  });
}

async function get402(port: number) {
  const res = await fetch(`http://127.0.0.1:${port}/api/data`);
  return (await res.json()) as { paymentId: string; payee: { vpa: string }; payment: { amount: number } };
}

function signedAuth(kp: { privateKey: string; publicKey: string }, paymentId: string, amount: number, vpa: string) {
  const ts = Math.floor(Date.now() / 1000);
  const sig = signPayment(kp.privateKey, paymentId, amount, vpa, ts);
  return `UPI-Mandate umn=M1&txnRef=TX${Date.now()}&paymentId=${paymentId}&amount=${amount}&ts=${ts}&pub=${encodeURIComponent(kp.publicKey)}&sig=${encodeURIComponent(sig)}`;
}

describe("MemoryStore", () => {
  it("issue then consume returns true", async () => {
    const store = new MemoryStore();
    await store.issue("id-1");
    expect(await store.consume("id-1")).toBe(true);
    store.destroy();
  });

  it("double consume returns false", async () => {
    const store = new MemoryStore();
    await store.issue("id-2");
    expect(await store.consume("id-2")).toBe(true);
    expect(await store.consume("id-2")).toBe(false);
    store.destroy();
  });

  it("unknown id returns false", async () => {
    const store = new MemoryStore();
    expect(await store.consume("never-issued")).toBe(false);
    store.destroy();
  });

  it("expired entries get cleaned up", async () => {
    const store = new MemoryStore(50);
    await store.issue("short-lived");
    await new Promise((r) => setTimeout(r, 100));
    // Trigger cleanup manually via consume — entry is expired
    // The cleanup interval is 60s, but the TTL is 50ms
    // After 100ms the entry should be stale
    // consume still works on the map directly, but let's verify
    // by issuing a new one and checking the old is gone after cleanup
    // Force cleanup by creating new store with same ttl
    expect(await store.consume("short-lived")).toBe(false);
    store.destroy();
  });
});

describe("timestamp rejection", () => {
  it("rejects signed request with timestamp older than 5 minutes", async () => {
    const app = express();
    app.get("/api/data", upi402({ vpa: "m@y", amount: 100 }), (_req, res) => res.json({ ok: true }));
    const { port, close } = await listen(app);

    const body = await get402(port);
    const kp = generateKeyPair();
    const staleTs = Math.floor(Date.now() / 1000) - 400;
    const sig = signPayment(kp.privateKey, body.paymentId, 100, "m@y", staleTs);
    const auth = `UPI-Mandate umn=M1&txnRef=TX1&paymentId=${body.paymentId}&amount=100&ts=${staleTs}&pub=${encodeURIComponent(kp.publicKey)}&sig=${encodeURIComponent(sig)}`;

    const res = await fetch(`http://127.0.0.1:${port}/api/data`, { headers: { Authorization: auth } });
    expect(res.status).toBe(402);
    const err = (await res.json()) as { error: string };
    expect(err.error).toBe("timestamp_expired");
    close();
  });

  it("rejects signed request with timestamp from the future", async () => {
    const app = express();
    app.get("/api/data", upi402({ vpa: "m@y", amount: 100 }), (_req, res) => res.json({ ok: true }));
    const { port, close } = await listen(app);

    const body = await get402(port);
    const kp = generateKeyPair();
    const futureTs = Math.floor(Date.now() / 1000) + 400;
    const sig = signPayment(kp.privateKey, body.paymentId, 100, "m@y", futureTs);
    const auth = `UPI-Mandate umn=M1&txnRef=TX1&paymentId=${body.paymentId}&amount=100&ts=${futureTs}&pub=${encodeURIComponent(kp.publicKey)}&sig=${encodeURIComponent(sig)}`;

    const res = await fetch(`http://127.0.0.1:${port}/api/data`, { headers: { Authorization: auth } });
    expect(res.status).toBe(402);
    const err = (await res.json()) as { error: string };
    expect(err.error).toBe("timestamp_expired");
    close();
  });
});

describe("paymentId fabrication", () => {
  it("rejects a paymentId the server never issued", async () => {
    const app = express();
    app.get("/api/data", upi402({ vpa: "m@y", amount: 100 }), (_req, res) => res.json({ ok: true }));
    const { port, close } = await listen(app);

    const kp = generateKeyPair();
    const fakeId = "fabricated-payment-id-never-issued";
    const auth = signedAuth(kp, fakeId, 100, "m@y");

    const res = await fetch(`http://127.0.0.1:${port}/api/data`, { headers: { Authorization: auth } });
    expect(res.status).toBe(402);
    const err = (await res.json()) as { error: string };
    expect(err.error).toBe("payment_id_invalid");
    close();
  });
});

describe("error sanitization", () => {
  it("verifier throws detailed error but client only sees debit_failed", async () => {
    const app = express();
    app.get(
      "/api/data",
      upi402({
        vpa: "m@y",
        amount: 100,
        verify: async () => { throw new Error("Razorpay API key rzp_test_xxx is invalid, account suspended"); },
      }),
      (_req, res) => res.json({ ok: true }),
    );
    const { port, close } = await listen(app);

    const res = await fetch(`http://127.0.0.1:${port}/api/data`, {
      headers: { Authorization: "UPI-Mandate umn=M1&txnRef=TX1" },
    });
    expect(res.status).toBe(402);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("debit_failed");
    expect(body.error).not.toContain("rzp_test");
    expect(body.error).not.toContain("suspended");
    close();
  });

  it("verifier returns failure with details but client only sees debit_failed", async () => {
    const app = express();
    app.get(
      "/api/data",
      upi402({
        vpa: "m@y",
        amount: 100,
        verify: async () => ({ success: false, error: "internal: token cust_xxx expired at 2025-01-01" }),
      }),
      (_req, res) => res.json({ ok: true }),
    );
    const { port, close } = await listen(app);

    const res = await fetch(`http://127.0.0.1:${port}/api/data`, {
      headers: { Authorization: "UPI-Mandate umn=M1&txnRef=TX1" },
    });
    expect(res.status).toBe(402);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("debit_failed");
    close();
  });
});

describe("custom store", () => {
  it("middleware uses the provided store", async () => {
    const issued: string[] = [];
    const consumed: string[] = [];

    const mockStore: PaymentIdStore = {
      async issue(id) { issued.push(id); },
      async consume(id) {
        consumed.push(id);
        return issued.includes(id);
      },
      async status(id) {
        if (!issued.includes(id)) return "unknown";
        return consumed.includes(id) ? "consumed" : "issued";
      },
    };

    const app = express();
    app.get(
      "/api/data",
      upi402({ vpa: "m@y", amount: 100, store: mockStore }),
      (_req, res) => res.json({ ok: true }),
    );
    const { port, close } = await listen(app);

    // First request issues a paymentId
    await fetch(`http://127.0.0.1:${port}/api/data`);
    expect(issued.length).toBe(1);

    // Signed request consumes it
    const kp = generateKeyPair();
    const body = await get402(port);
    expect(issued.length).toBe(2);

    const auth = signedAuth(kp, body.paymentId, 100, "m@y");
    await fetch(`http://127.0.0.1:${port}/api/data`, { headers: { Authorization: auth } });
    expect(consumed).toContain(body.paymentId);

    close();
  });
});
