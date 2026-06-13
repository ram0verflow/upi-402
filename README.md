# upi-402

Open HTTP 402 payment standard for UPI.

x402 brought HTTP 402 to crypto. L402 brought it to Lightning. This brings it to UPI — the world's largest real-time payment network. 23 billion transactions/month. Open standard. PA-agnostic. 

## Install

```bash
npm install upi-402
```

## Quick start

**Server** (5 lines):

```typescript
import express from 'express';
import { upi402 } from 'upi-402';

const app = express();
app.get('/api/data', upi402({ vpa: 'merchant@ybl', amount: 100 }), (req, res) => {
  res.json({ secret: 'paid content', receipt: req.upi402.receipt });
});
app.listen(3000);
```

**Client** (3 lines):

```typescript
import { upi402Fetch } from 'upi-402/client';

const res = await upi402Fetch('http://localhost:3000/api/data', { mandateRef: 'TEST-001' });
console.log(await res.json()); // { secret: 'paid content', receipt: {...} }
```

Run both. The client gets a 402, retries with the mandate header, gets 200 + receipt. Zero configuration — mock mode is the default.

## The protocol

### 1. Server returns 402

```
HTTP/1.1 402 Payment Required
X-UPI-402-Version: 1

{
  "upi402": 1,
  "payee": { "vpa": "merchant@ybl", "name": "Example API" },
  "payment": { "amount": 500, "currency": "INR", "description": "API access" },
  "mandate": { "required": true, "maxAmount": 5000, "frequency": "DAILY" }
}
```

### 2. Client retries with mandate

```
GET /api/data HTTP/1.1
Authorization: UPI-Mandate umn=ABCD1234567890&txnRef=TXN789
```

### 3. Server verifies and responds

```
HTTP/1.1 200 OK
X-UPI-402-Receipt: {"txnId":"UPI123","amount":500,"timestamp":"2026-06-13T14:32:18Z","umn":"ABCD1234567890"}

{ "data": "..." }
```

See [SPEC.md](./SPEC.md) for the full protocol specification.

## Server middleware API

```typescript
import { upi402 } from 'upi-402';

app.get('/api/data', upi402(options), handler);
```

### Options

| Option | Type | Required | Default | Description |
|--------|------|----------|---------|-------------|
| `vpa` | string | yes | — | Merchant UPI VPA |
| `name` | string | no | same as vpa | Merchant display name |
| `amount` | number | yes | — | Amount in INR |
| `currency` | string | no | `"INR"` | Currency code |
| `description` | string | no | — | Payment description |
| `mandate` | object | no | `{ required: true }` | Mandate configuration |
| `requireSignature` | boolean | no | `false` | Reject unsigned requests |
| `verify` | function | no | mock verifier | Verification function |

### With a real verifier

```typescript
import { razorpayVerifier } from 'upi-402/verifiers/razorpay';

app.get('/api/data', upi402({
  vpa: 'merchant@ybl',
  amount: 500,
  verify: razorpayVerifier({
    keyId: process.env.RAZORPAY_KEY_ID,
    keySecret: process.env.RAZORPAY_KEY_SECRET
  })
}), handler);
```

### With a custom verifier

```typescript
app.get('/api/data', upi402({
  vpa: 'merchant@ybl',
  amount: 500,
  verify: async (mandateRef, amount, txnRef) => {
    const result = await yourPA.executeDebit(mandateRef, amount);
    return { success: result.ok, txnId: result.txnId };
  }
}), handler);
```

### Verify function signature

```typescript
type VerifyFunction = (
  mandateRef: string,
  amount: number,
  txnRef: string,
  metadata?: Record<string, any>
) => Promise<{ success: boolean; txnId?: string; error?: string }>;
```

## Client API

```typescript
import { upi402Fetch } from 'upi-402/client';

const res = await upi402Fetch(url, options);
```

### Options

| Option | Type | Required | Default | Description |
|--------|------|----------|---------|-------------|
| `mandateRef` | string | yes | — | UPI Unique Mandate Number |
| `txnRef` | string | no | auto-generated | Transaction reference for idempotency |
| `privateKey` | string | no | auto-generated | Ed25519 private key (base64). Auto-generates a keypair per session if omitted. |
| `maxRetries` | number | no | `1` | Max retry attempts after 402 |
| `onPaymentRequired` | function | no | — | Called when 402 is received |
| `onPaymentComplete` | function | no | — | Called after successful payment |

The client wraps `fetch` with 402 retry logic. When the server returns a `paymentId` in the 402 response, the client automatically signs the payment agreement with Ed25519 before retrying. The response has a `.upi402Receipt` property with the payment receipt.

### Error handling

```typescript
import { upi402Fetch, UPI402PaymentError } from 'upi-402/client';

try {
  const res = await upi402Fetch(url, { mandateRef: 'MANDATE-001' });
} catch (err) {
  if (err instanceof UPI402PaymentError) {
    console.log(err.details.error);    // "mandate_expired", "debit_failed", etc.
    console.log(err.details.payee.vpa); // merchant VPA
  }
}
```

## Verifier Status

| Verifier | Status | Notes |
|----------|--------|-------|
| Mock | Tested | Full 402 -> retry -> 200 flow, all tests passing |
| Razorpay | Implemented | Requires S2S enablement on Razorpay account |
| PhonePe | From docs | Built from API documentation, not tested with credentials |
| Cashfree | From docs | Built from API documentation, not tested with credentials |
| Stripe | From docs | Built from API documentation, not tested with credentials |
| Custom | Supported | Pass any async function matching VerifyFunction interface |

Contributions testing verifiers with real PA credentials are very welcome.

Agent-side code (`upi-402/client`) has zero dependencies. Verifier code is server-side only and tree-shakeable — importing `upi-402/client` never pulls in any PA SDK.

## How UPI mandates work

UPI is a single real-time payment network operated by NPCI (National Payments Corporation of India). PhonePe, Google Pay, Paytm, Razorpay, bank apps, and even `*99#` USSD are all interfaces into the same system.

A **mandate** (also called autopay/recurring authorization) is a pre-approved debit permission. The user sets it up through any UPI app — the standard doesn't care which. The mandate gets a Unique Mandate Number (UMN) at the NPCI level. Any Payment Aggregator (PA) can then execute debits against that UMN within the approved limits.

This protocol uses mandates because:
- The agent doesn't need to be present for each payment
- The user approves once, the agent can pay within limits
- It works exactly like how subscription services use UPI autopay today

## Payment scoping (overcharge protection)

A malicious merchant could debit more than the agreed amount from a UPI mandate. NPCI enforces mandate-level limits but not per-transaction agreements. upi-402 solves this with decentralized payment scoping — no central authority required.

### How it works

1. Server returns 402 with a unique `paymentId`
2. Client signs `paymentId:amount:merchantVpa:timestamp` with Ed25519
3. Client sends signature + public key in the Authorization header
4. Middleware verifies the signature and passes the **signed amount** to the verifier
5. If the server tries to debit a different amount, the middleware blocks it

```
Client signs: "pay-uuid:500:merchant@ybl:1718300000"
Server receives: signature proves client agreed to exactly ₹500
Middleware: passes ₹500 to verifier, regardless of server config
```

### What this prevents

- **Overcharge**: merchant debits ₹500 when client agreed to ₹100 — middleware blocks
- **Replay**: merchant reuses a paymentId — middleware blocks (single-use)
- **Tampering**: man-in-middle changes the amount — signature verification fails

### What this doesn't prevent

- Merchant modifies the middleware source code — but client holds signed evidence for dispute
- Same trust model as HTTPS: you trust the software, disputes handle bad actors

### Backward compatibility

Signing is opt-in. Unsigned requests still work by default. Set `requireSignature: true` on the middleware to enforce signed requests.

## Future: Agent Identity

The `Authorization` header is designed to be extensible. v2 may add:

```
Authorization: UPI-Mandate umn=ABCD1234&txnRef=TXN789&agent=did:web:myagent.dev&grant=eyJhbG...
```

v1 ships without identity fields. The header parser ignores unknown fields, so v1 servers work with v2 clients.

## Use with PayRouter

```typescript
import { upi402Fetch } from 'upi-402/client';
// Plug into PayRouter's UPI adapter — one import, handles the 402 handshake.
```

## Contributing

Especially wanted:
- Testing PhonePe, Cashfree, and Stripe verifiers with real credentials
- Additional PA verifiers (Paytm, PayU, etc.)
- Framework adapters beyond Express (Hono, Fastify, etc.)

## License

Apache 2.0
