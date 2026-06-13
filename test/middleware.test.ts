import { describe, it, expect } from "vitest";
import express from "express";
import { upi402 } from "../src/middleware.js";

function createApp() {
  const app = express();
  app.get(
    "/api/data",
    upi402({ vpa: "test@upi", amount: 100, description: "test resource" }),
    (_req, res) => {
      res.json({ data: "secret content", receipt: _req.upi402?.receipt });
    },
  );
  return app;
}

async function request(app: express.Express, path: string, headers?: Record<string, string>) {
  return new Promise<{ status: number; body: Record<string, unknown>; headers: Record<string, string> }>((resolve) => {
    const server = app.listen(0, async () => {
      const addr = server.address() as { port: number };
      const res = await fetch(`http://127.0.0.1:${addr.port}${path}`, { headers });
      const body = await res.json();
      const resHeaders: Record<string, string> = {};
      res.headers.forEach((v, k) => { resHeaders[k] = v; });
      server.close();
      resolve({ status: res.status, body: body as Record<string, unknown>, headers: resHeaders });
    });
  });
}

describe("upi402 middleware", () => {
  it("returns 402 when no authorization header", async () => {
    const app = createApp();
    const res = await request(app, "/api/data");
    expect(res.status).toBe(402);
    expect(res.body.upi402).toBe(1);
    expect((res.body.payee as Record<string, unknown>).vpa).toBe("test@upi");
    expect((res.body.payment as Record<string, unknown>).amount).toBe(100);
  });

  it("returns 402 when authorization header is wrong scheme", async () => {
    const app = createApp();
    const res = await request(app, "/api/data", { Authorization: "Bearer token" });
    expect(res.status).toBe(402);
  });

  it("returns 200 with mock receipt when valid mandate header", async () => {
    const app = createApp();
    const res = await request(app, "/api/data", {
      Authorization: "UPI-Mandate umn=TEST123&txnRef=TXN456",
    });
    expect(res.status).toBe(200);
    expect(res.body.data).toBe("secret content");
    expect(res.headers["x-upi-402-receipt"]).toBeTruthy();
    const receipt = JSON.parse(res.headers["x-upi-402-receipt"]);
    expect(receipt.mock).toBe(true);
    expect(receipt.umn).toBe("TEST123");
    expect(receipt.amount).toBe(100);
  });

  it("sets X-UPI-402-Version header on 402", async () => {
    const app = createApp();
    const res = await request(app, "/api/data");
    expect(res.headers["x-upi-402-version"]).toBe("1");
  });

  it("uses custom verify function", async () => {
    const app = express();
    app.get(
      "/api/custom",
      upi402({
        vpa: "m@y",
        amount: 50,
        verify: async (_umn, _amount, _txnRef) => ({
          success: true,
          txnId: "CUSTOM-TXN-001",
        }),
      }),
      (_req, res) => {
        res.json({ ok: true });
      },
    );

    const res = await request(app, "/api/custom", {
      Authorization: "UPI-Mandate umn=REAL123&txnRef=TX1",
    });
    expect(res.status).toBe(200);
    const receipt = JSON.parse(res.headers["x-upi-402-receipt"]);
    expect(receipt.txnId).toBe("CUSTOM-TXN-001");
    expect(receipt.mock).toBeUndefined();
  });

  it("returns 402 with error when verify fails", async () => {
    const app = express();
    app.get(
      "/api/fail",
      upi402({
        vpa: "m@y",
        amount: 50,
        verify: async () => ({ success: false, error: "insufficient_funds" }),
      }),
      (_req, res) => {
        res.json({ ok: true });
      },
    );

    const res = await request(app, "/api/fail", {
      Authorization: "UPI-Mandate umn=BAD&txnRef=TX1",
    });
    expect(res.status).toBe(402);
    expect(res.body.error).toBe("debit_failed");
  });
});
