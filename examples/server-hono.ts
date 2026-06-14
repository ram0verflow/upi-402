// Hono / Bun / Deno / Cloudflare Workers example
// Uses handleUPI402 directly — no Express needed
//
// Run with: bun run examples/server-hono.ts
// Or adapt for any framework that uses Web Standard Request/Response

import { handleUPI402 } from "../src/handler.js";

const port = 3000;

Bun.serve({
  port,
  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === "/api/data") {
      const result = await handleUPI402(request, {
        vpa: "merchant@ybl",
        amount: 100,
        description: "API access",
      });

      if (result.action !== "payment_confirmed") {
        return result.response!;
      }

      return new Response(
        JSON.stringify({ data: "paid content", receipt: result.receipt }),
        {
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    return new Response("Not found", { status: 404 });
  },
});

console.log(`Hono/Bun server on http://localhost:${port}`);
console.log("Try: curl http://localhost:3000/api/data");
