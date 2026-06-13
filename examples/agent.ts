import { upi402Fetch } from "../src/client.js";

async function main() {
  const url = process.argv[2] || "http://localhost:3000/api/data";
  const mandateRef = process.argv[3] || "TEST-MANDATE-001";

  console.log(`Requesting ${url} with mandate ${mandateRef}\n`);

  const res = await upi402Fetch(url, {
    mandateRef,
    onPaymentRequired: (details) => {
      console.log(`402 Payment Required: ${details.payment.amount} ${details.payment.currency} to ${details.payee.vpa}`);
    },
    onPaymentComplete: (receipt) => {
      console.log(`Payment complete: txnId=${receipt.txnId} mock=${receipt.mock ?? false}`);
    },
  });

  console.log(`\nResponse: ${res.status}`);
  console.log(JSON.stringify(await res.json(), null, 2));
}

main().catch(console.error);
