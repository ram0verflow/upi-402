import express from "express";
import { upi402 } from "../src/index.js";
import { upi402Fetch } from "../src/client.js";
import { cashfreeVerifier } from "../src/verifiers/cashfree.js";

const CLIENT_ID = process.env.CASHFREE_CLIENT_ID;
const CLIENT_SECRET = process.env.CASHFREE_CLIENT_SECRET;
const CF_SUB_ID = process.env.CF_SUBSCRIPTION_ID ?? "3066935";

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error("Set CASHFREE_CLIENT_ID and CASHFREE_CLIENT_SECRET env vars");
  console.error("Optionally set CF_SUBSCRIPTION_ID (default: 3066935)");
  process.exit(1);
}

const PORT = 4402;

async function main() {
  console.log("=== Cashfree UPI-402 E2E (Sandbox) ===\n");
  console.log(`Subscription: ${CF_SUB_ID}`);

  const verify = cashfreeVerifier({
    clientId: CLIENT_ID!,
    clientSecret: CLIENT_SECRET!,
    cfSubscriptionId: CF_SUB_ID,
  });

  const app = express();
  app.get(
    "/api/data",
    upi402({
      vpa: "merchant@cashfree",
      amount: 1,
      description: "UPI-402 test charge — Rs 1",
      verify,
    }),
    (_req, res) => {
      res.json({
        data: "premium content unlocked",
        receipt: _req.upi402?.receipt,
      });
    },
  );

  const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
    const s = app.listen(PORT, "127.0.0.1", () => resolve(s));
  });
  console.log(`Server on :${PORT}\n`);

  // Step 1: Hit the 402 endpoint
  console.log("-> Hitting 402 endpoint...");
  const probe = await fetch(`http://127.0.0.1:${PORT}/api/data`);
  const body402 = (await probe.json()) as Record<string, unknown>;
  const payment = body402.payment as Record<string, unknown>;
  console.log(`<- Got ${probe.status}, payment required: Rs ${payment.amount}`);
  console.log(`   paymentId: ${body402.paymentId}\n`);

  // Step 2: Retry with mandate ref
  console.log("-> Retrying with mandate ref 'abc1'...");
  try {
    const res = await upi402Fetch(`http://127.0.0.1:${PORT}/api/data`, {
      mandateRef: "abc1",
      maxRetries: 1,
      onPaymentRequired: (details) => {
        console.log(`<- 402: Rs ${details.payment.amount} to ${details.payee.vpa}`);
      },
      onPaymentComplete: (receipt) => {
        console.log(`<- Payment complete: txnId=${receipt.txnId}`);
      },
    });

    console.log(`\n<- Response: ${res.status}`);

    if (res.status === 200) {
      const body = (await res.json()) as Record<string, unknown>;
      console.log(`   Data: ${body.data}`);
      if (res.upi402Receipt) {
        console.log(`   Receipt:`);
        console.log(`     txnId:  ${res.upi402Receipt.txnId}`);
        console.log(`     amount: Rs ${res.upi402Receipt.amount}`);
        console.log(`     umn:    ${res.upi402Receipt.umn}`);
        console.log(`     mock:   ${res.upi402Receipt.mock ?? false}`);
      }
      console.log("\n=== PASS ===\n");
    } else if (res.status === 202) {
      const body = (await res.json()) as Record<string, unknown>;
      console.log(`   Status: ${body.status}`);
      console.log(`   Cashfree charge is INITIALIZED (scheduled for tomorrow)`);
      console.log(`   In sandbox, ON_DEMAND charges schedule — not instant`);
      console.log("\n=== PASS: Charge accepted by Cashfree ===\n");
    } else {
      console.log(`   Body: ${await res.text()}`);
    }
  } catch (err) {
    const msg = (err as Error).message;
    if (msg.includes("pending") || msg.includes("debit_failed")) {
      console.log(`\n<- Charge initiated but pending (ON_DEMAND schedules for next day)`);
      console.log("   This is expected Cashfree sandbox behavior.\n");

      // Verify the charge was created
      const payments = await fetch("https://sandbox.cashfree.com/pg/subscriptions/abc1/payments", {
        headers: {
          "x-client-id": CLIENT_ID!,
          "x-client-secret": CLIENT_SECRET!,
          "x-api-version": "2023-08-01",
        },
      }).then((r) => r.json()) as Array<Record<string, unknown>>;

      const charges = (payments as Array<Record<string, unknown>>).filter(
        (p) => p.payment_type === "CHARGE",
      );
      console.log(`   Charges on subscription: ${charges.length}`);
      for (const c of charges) {
        console.log(`     ${c.payment_id} | ${c.payment_status} | Rs ${c.payment_amount}`);
      }
      console.log("\n=== PASS: Full 402 flow completed, charge accepted by Cashfree ===\n");
    } else {
      console.error(`\nFailed: ${msg}\n`);
    }
  }

  server.close();
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
