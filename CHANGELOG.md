# Changelog

## 0.1.0 (2026-06-14)

Initial release.

- Protocol spec (SPEC.md) — 402 response, UPI-Mandate authorization header, receipt header, error codes
- Web Standard handler (`handleUPI402`) — framework-agnostic, works on Hono/Bun/Deno/Cloudflare/Next.js
- Express middleware (`upi402`) — thin adapter over handler
- Client (`upi402Fetch`) — fetch wrapper with automatic 402 retry and 202 polling
- MCP server (`upi-402-mcp`) — stdio transport, pay and check tools
- Ed25519 payment scoping — signed amount agreements, replay prevention, timestamp validation
- PaymentIdStore — pluggable store with MemoryStore default, TTL-based expiry
- Mock verifier — full flow testing with zero configuration
- Razorpay verifier — targets POST /v1/payments/create/recurring (instant charge)
- 60 tests across 8 test files
