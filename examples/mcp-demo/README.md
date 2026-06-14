# UPI-402 MCP Demo

Connect Claude Desktop to a mock SaaS API with paid endpoints. Claude discovers the service, hits 402 paywalls, asks you to set up a UPI mandate, then auto-pays on every subsequent request.

## Architecture

```
Claude Desktop
    | (MCP Streamable HTTP)
    v
MCP Server (:4403)          — exposes tools: browse, access, setup_mandate, spending
    | (HTTP + upi-402)
    v
IndiaMarkets API (:4402)    — mock fintech SaaS with 402-gated endpoints
```

## Run

```bash
cd examples/mcp-demo
npm install
npx tsx start.ts
```

## Connect Claude Desktop

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "upi-402-demo": {
      "url": "http://127.0.0.1:4403/mcp"
    }
  }
}
```

Restart Claude Desktop.

## Usage

Ask Claude:

1. **"What services are available on the IndiaMarkets API?"**
   Claude calls `browse_service`, sees the catalog and prices.

2. **"Show me the Nifty 50 data"**
   Claude calls `access_content` → gets 402 → tells you a mandate is needed.

3. **"Set up my mandate with ref MY-MANDATE-001"**
   Claude calls `setup_mandate` → stores the ref for the session.

4. **"Now show me the Nifty 50 data"**
   Claude calls `access_content` → auto-pays Rs 5 → returns live data with receipt.

5. **"Get me a research report and trading signals"**
   Claude auto-pays Rs 50 + Rs 100 → returns both.

6. **"How much have I spent?"**
   Claude calls `get_spending` → shows all payments and receipts.

## MCP Tools

| Tool | Description |
|------|-------------|
| `browse_service` | Discover available endpoints and prices |
| `access_content` | Access a paid endpoint (auto-pays if mandate configured) |
| `setup_mandate` | Configure UPI mandate ref for automatic payments |
| `get_spending` | Show all payments made in this session |

## Mock mode

Everything runs in mock mode — no real UPI, no real money. Any string works as a mandate ref. Payments are signed with Ed25519 for overcharge protection even in mock mode.
