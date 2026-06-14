# Payment Aggregator Research for upi-402

## The Problem

upi-402 needs instant debit against UPI mandates. Agent hits 402, pays, gets resource — synchronous. This rules out any PA that requires scheduled charges with future dates.

## UPI Mandate Types

- **UPI AutoPay (e-mandate)**: Scheduled debits with 24h pre-debit notification. Cannot charge same-day. NOT suitable for 402.
- **UPI Reserve Pay (SBMD)**: Block funds upfront, debit instantly against blocked balance. Suitable for 402.
- **UPI One Time Mandate (OTM)**: Block once, debit once. Suitable for single-payment 402.
- **Recurring Payments (token-based)**: Authorize once, charge on-demand via API with token. Suitable for 402.

## PA Evaluation

### Razorpay — Recommended

**Recurring Payments (token-based)**: `POST /v1/payments/create/recurring`
- No payment_schedule_date required. Instant charge on demand.
- Authorization flow: create customer, create order with token params, customer authorizes via UPI app, token_id issued.
- Subsequent charges: POST with token_id, customer_id, amount. Synchronous response.
- Requires S2S (server-to-server) enablement on Razorpay account (request from dashboard support).
- Test VPAs: `success@razorpay` (auto-approves), `failure@razorpay` (auto-fails).
- Documentation: https://razorpay.com/docs/payments/payment-gateway/s2s-integration/recurring-payments/upi

**Reserve Pay (SBMD)**: Also supported via Razorpay. Instant debit against pre-blocked funds. No scheduling required.

### Cashfree — Not suitable

Tested extensively with sandbox credentials (June 2026).

- Subscription creation: `POST /pg/subscriptions` — works.
- Authorization: `POST /pg/subscriptions/pay` with `payment_type: AUTH` — works, returns simulator link for sandbox.
- **Charging**: `POST /pg/subscriptions/pay` with `payment_type: CHARGE` — **requires `payment_schedule_date` set to a future date**. This is mandatory even for ON_DEMAND plan types.
- Charges enter `INITIALIZED` state and only transition to `SUCCESS` when Cashfree's internal scheduler processes them on the scheduled date.
- The sandbox simulate API (`PUT /api/v2/subscriptions/charge/{id}/simulate`) cannot transition charges from `INITIALIZED` — only from `PENDING`.
- The legacy V2 API (`POST /api/v2/subscriptions/{cf_id}/charge`) also requires `scheduledOn`.

This makes Cashfree incompatible with synchronous 402 flows where the agent needs an instant response within the HTTP request lifecycle.

### Decentro — Possible but complex

Has "instant presentation" within 5-minute window using `is_downpayment` flag in their SBMD API. But staging credentials are sales-gated (not self-serve). More complex integration path.

### PhonePe PG — Not evaluated for instant charge

Has Autopay/Recurring APIs. Not tested whether charges can execute instantly or require scheduling. Documentation suggests scheduled execution similar to Cashfree. Needs investigation with real credentials.

### PayU — Not evaluated

Has recurring payment APIs. Subscription enablement requires Key Account Manager assignment. Not tested.

## Conclusion

Razorpay's token-based recurring payments are the only verified path for instant, on-demand UPI debits via API without scheduling. The Razorpay verifier in this project targets `POST /v1/payments/create/recurring`.

Community contributions welcome for other PAs that support instant charge without scheduling.
