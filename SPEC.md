# UPI-402 Protocol Specification

**Version:** 1.0.0-draft

An open HTTP payment protocol for UPI. Defines how a server advertises a price on an HTTP endpoint and how a client pays using a UPI mandate.

---

## 402 Response

When an endpoint requires payment and the request has no valid authorization, the server responds:

```
HTTP/1.1 402 Payment Required
Content-Type: application/json
X-UPI-402-Version: 1
```

### Body Schema

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `upi402` | integer | yes | Protocol version. Always `1`. |
| `paymentId` | string | yes | Server-generated UUID. Single-use. |
| `payee.vpa` | string | yes | Merchant UPI VPA |
| `payee.name` | string | yes | Human-readable merchant name |
| `payment.amount` | number | yes | Amount in rupees |
| `payment.currency` | string | yes | Always `"INR"` |
| `payment.description` | string | no | What the payment is for |
| `mandate.required` | boolean | no | Whether a mandate is needed |
| `mandate.maxAmount` | number | no | Max per-debit amount |
| `mandate.frequency` | string | no | `DAILY`, `WEEKLY`, `MONTHLY`, `ON_DEMAND` |
| `mandate.validUntil` | string | no | ISO 8601 date |
| `mandate.setupUrl` | string | no | URL to set up a mandate |
| `receipt.endpoint` | string | no | URL to check payment status |
| `error` | string | no | Error code on retry failures |

### Example

```json
{
  "upi402": 1,
  "paymentId": "550e8400-e29b-41d4-a716-446655440000",
  "payee": { "vpa": "merchant@ybl", "name": "Example API" },
  "payment": { "amount": 500, "currency": "INR", "description": "API access" },
  "mandate": {
    "required": true,
    "maxAmount": 5000,
    "frequency": "DAILY",
    "validUntil": "2026-12-31"
  }
}
```

## Authorization Header

### Unsigned (backward compatible)

```
Authorization: UPI-Mandate umn=<UMN>&txnRef=<TXN_REF>
```

### Signed (recommended)

```
Authorization: UPI-Mandate umn=<UMN>&txnRef=<TXN_REF>&paymentId=<PAYMENT_ID>&amount=<AMOUNT>&ts=<TIMESTAMP>&pub=<PUBLIC_KEY>&sig=<SIGNATURE>
```

| Parameter | Required | Description |
|-----------|----------|-------------|
| `umn` | yes | Unique Mandate Number (NPCI identifier) |
| `txnRef` | yes | Client-generated transaction reference for idempotency |
| `paymentId` | for signed | The `paymentId` from the 402 response |
| `amount` | for signed | Amount the client agrees to pay (must match 402) |
| `ts` | for signed | Unix timestamp of the signing |
| `pub` | for signed | Client's Ed25519 public key (base64, URL-encoded) |
| `sig` | for signed | Ed25519 signature (base64, URL-encoded) |

Unknown parameters MUST be ignored by the server (forward compatibility).

**Reserved for future versions:** `agent`, `grant`

## Payment Scoping (Signature Protocol)

Payment scoping prevents a merchant from debiting more than the agreed amount. Both sides hold cryptographic proof of what was agreed.

### Signature Construction

The client signs the following message using Ed25519:

```
message = "{paymentId}:{amount}:{merchantVpa}:{timestamp}"
signature = Ed25519.sign(privateKey, message)
```

### Verification Rules

The server MUST:
1. Verify the Ed25519 signature against the provided public key
2. Confirm the signed `amount` matches the amount in the 402 response
3. Confirm the `paymentId` has not been used before (replay prevention)
4. Pass the **signed amount** (not the server-configured amount) to the payment verifier

If any check fails, the server returns 402 with an error code.

### Error Codes (Signing)

| Code | Description |
|------|-------------|
| `signature_required` | Server requires signed requests but none was provided |
| `signature_invalid` | Ed25519 signature verification failed |
| `amount_mismatch` | Signed amount does not match the 402 challenge |
| `payment_id_invalid` | paymentId was never issued or has already been consumed |
| `timestamp_expired` | Signed timestamp is outside the acceptable window |

### Backward Compatibility

Servers MAY accept unsigned requests for gradual adoption. The `requireSignature` configuration option controls this behavior. When false (default), unsigned requests fall through to the standard verification flow.

## Receipt Header

On successful payment, the server includes:

```
X-UPI-402-Receipt: {"txnId":"...","amount":500,"currency":"INR","timestamp":"...","umn":"..."}
```

The receipt is a JSON object with at minimum: `txnId`, `amount`, `currency`, `timestamp`, `umn`.

## Error Header

On payment failure, the server includes:

```
X-UPI-402-Error: <error_code>
```

### Error Codes

| Code | Description |
|------|-------------|
| `mandate_expired` | Mandate has expired or been revoked |
| `mandate_invalid` | Mandate reference not found |
| `debit_failed` | Debit execution failed at the PA |
| `insufficient_funds` | Payer account has insufficient balance |
| `limit_exceeded` | Debit exceeds mandate amount or frequency limit |

## HTTP Status Codes

| Code | When |
|------|------|
| 402 | Payment required or payment failed |
| 200 | Payment successful, resource returned |
| 400 | Malformed authorization header |
| 500 | Server-side processing error |

## UPI Mandate Constraints

Per NPCI circular UPI-OC-No-200-FY-24-25 (Single Block Multi Debit / Reserve Pay):

- One active block per merchant per customer
- Maximum amount: Rs 10,000 for Reserve Pay mandates (90-day validity)
- Standard UPI Autopay mandates support higher limits depending on merchant category
- Mandate frequency options: as_presented, daily, weekly, monthly, quarterly, yearly

Implementations SHOULD respect these limits and communicate them clearly in the 402 response body via the `mandate.maxAmount` and `mandate.frequency` fields.

## Security Considerations

- Mandate UMNs MUST be treated as bearer credentials. Transmit only over HTTPS.
- Servers SHOULD validate txnRef uniqueness to prevent replay attacks.
- The protocol does not define application-level authentication. Layer it on top as needed.
- Servers SHOULD rate-limit 402 responses to prevent mandate enumeration.
- PAs (Payment Aggregators) handle all money movement. Neither client nor server touches funds directly.
- paymentIds are server-issued challenges. They are single-use and expire after 5 minutes. Servers MUST NOT accept a paymentId they did not issue.
- Signed timestamps MUST be within 5 minutes of server time. This bounds the replay window even if the paymentId store loses state (e.g., process restart).
- Implementers MUST use persistent storage for the PaymentIdStore in production if the replay window after process restart is unacceptable for their use case.
- The default in-memory store is suitable for single-process deployments where a 5-minute replay window after restart is acceptable (bounded by timestamp validation).
- Servers MUST NOT expose internal verifier error details to clients. The client-facing error code for all debit failures is `debit_failed`. Detailed errors should be logged server-side only.

## Future Extensions

### Agent Identity (v2)

The Authorization header is designed to be extensible. A future version may add:

```
Authorization: UPI-Mandate umn=ABCD1234&txnRef=TXN789&agent=did:web:myagent.dev&grant=eyJhbG...
```

- `agent` — Decentralized Identifier (DID) of the requesting agent
- `grant` — Delegated authorization token (e.g., Grantex JWT)

v1 servers MUST ignore these unknown fields, ensuring forward compatibility.

### Cross-PA Mandate Portability

Currently, mandate verification is tied to the merchant's PA. A future extension may define a standard verification endpoint that any PA can implement, enabling mandate portability across aggregators.
