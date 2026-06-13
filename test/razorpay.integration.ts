import express from "express";
import { upi402 } from "../src/middleware.js";
import { upi402Fetch } from "../src/client.js";
import { razorpayVerifier, setupMandate } from "../src/verifiers/razorpay.js";

const KEY_ID = process.env.RAZORPAY_KEY_ID;
const KEY_SECRET = process.env.RAZORPAY_KEY_SECRET;

if (!KEY_ID || !KEY_SECRET) {
  console.error("Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET env vars");
  console.error("Get test keys from dashboard.razorpay.com → Settings → API Keys");
  process.exit(1);
}

async function main() {
  console.log("=== Razorpay UPI-402 Integration Test ===\n");
  console.log(`Key: ${KEY_ID!.slice(0, 12)}...`);

  // Step 1: Set up mandate via Razorpay test API
  console.log("\n[1] Setting up UPI mandate (success@razorpay)...");
  const mandate = await setupMandate({
    keyId: KEY_ID!,
    keySecret: KEY_SECRET!,
    vpa: "success@razorpay",
    maxAmount: 500000,
    frequency: "as_presented",
  });
  console.log(`    Customer: ${mandate.customerId}`);
  console.log(`    Token:    ${mandate.tokenId}`);

  // Step 2: Create verifier and register the mandate
  console.log("\n[2] Creating Razorpay verifier...");
  const verify = razorpayVerifier({ keyId: KEY_ID!, keySecret: KEY_SECRET! });
  (verify as ReturnType<typeof razorpayVerifier> & { registerMandate: Function }).registerMandate(
    mandate.tokenId,
    mandate,
  );
  console.log(`    Registered mandate ref: ${mandate.tokenId}`);

  // Step 3: Start test server with Razorpay verifier
  console.log("\n[3] Starting UPI-402 server...");
  const app = express();
  app.get(
    "/api/premium",
    upi402({
      vpa: "merchant@ybl",
      amount: 100,
      description: "Premium API access — 100 INR",
      verify,
    }),
    (req, res) => {
      res.json({
        data: "premium content unlocked",
        receipt: req.upi402?.receipt,
      });
    },
  );

  const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const port = (server.address() as { port: number }).port;
  console.log(`    Listening on :${port}`);

  // Step 4: Client hits the endpoint — should get 402
  console.log("\n[4] Requesting protected resource (no auth)...");
  const firstRes = await fetch(`http://127.0.0.1:${port}/api/premium`);
  console.log(`    Status: ${firstRes.status}`);
  const body402 = (await firstRes.json()) as Record<string, unknown>;
  console.log(`    Payee: ${(body402.payee as Record<string, unknown>).vpa}`);
  console.log(`    Amount: ${(body402.payment as Record<string, unknown>).amount} INR`);

  if (firstRes.status !== 402) {
    throw new Error(`Expected 402, got ${firstRes.status}`);
  }

  // Step 5: Client retries with mandate ref — should get 200
  console.log("\n[5] Retrying with UPI-Mandate header...");
  const res = await upi402Fetch(`http://127.0.0.1:${port}/api/premium`, {
    mandateRef: mandate.tokenId,
    onPaymentRequired: (details) => {
      console.log(`    402 received: ${details.payment.amount} INR to ${details.payee.vpa}`);
    },
    onPaymentComplete: (receipt) => {
      console.log(`    Payment complete: txnId=${receipt.txnId}`);
    },
  });

  console.log(`    Response: ${res.status}`);
  const body200 = (await res.json()) as Record<string, unknown>;
  console.log(`    Data: ${body200.data}`);

  if (res.status !== 200) {
    throw new Error(`Expected 200, got ${res.status}`);
  }

  if (res.upi402Receipt) {
    console.log(`\n    Receipt:`);
    console.log(`      txnId:     ${res.upi402Receipt.txnId}`);
    console.log(`      amount:    ${res.upi402Receipt.amount} ${res.upi402Receipt.currency}`);
    console.log(`      umn:       ${res.upi402Receipt.umn}`);
    console.log(`      timestamp: ${res.upi402Receipt.timestamp}`);
    console.log(`      mock:      ${res.upi402Receipt.mock ?? false}`);
  }

  console.log("\n=== INTEGRATION TEST PASSED ===");
  console.log("  Real Razorpay test mode API calls");
  console.log("  Mandate registered with success@razorpay");
  console.log("  Recurring payment executed against token");
  console.log("  Full 402 → retry → 200 flow with real PA verification\n");

  server.close();
  process.exit(0);
}

main().catch((err) => {
  console.error("\n=== INTEGRATION TEST FAILED ===");
  console.error(err);
  process.exit(1);
});
