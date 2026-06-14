import { randomUUID } from "node:crypto";
import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod";
import { upi402Fetch } from "../../src/client.js";
import { generateKeyPair } from "../../src/signing.js";
import type { UPI402Receipt } from "../../src/types.js";

const SAAS_BASE = "http://127.0.0.1:4402";

interface Session {
  mandateRef: string | null;
  keyPair: { publicKey: string; privateKey: string };
  spending: Array<{ endpoint: string; amount: number; receipt: UPI402Receipt; time: string }>;
}

const session: Session = {
  mandateRef: null,
  keyPair: generateKeyPair(),
  spending: [],
};

function createMcpServer(): McpServer {
  const server = new McpServer({
    name: "upi-402-agent",
    version: "0.1.0",
  });

  server.registerTool(
    "browse_service",
    {
      description:
        "Browse the IndiaMarkets API service catalog. Shows available endpoints, their prices, and what data they return. Use this first to discover what's available.",
      inputSchema: {
        url: z.string().default(SAAS_BASE).describe("Service URL to browse"),
      },
    },
    async ({ url }) => {
      const res = await fetch(url);
      const catalog = await res.json();
      return {
        content: [{ type: "text" as const, text: JSON.stringify(catalog, null, 2) }],
      };
    },
  );

  server.registerTool(
    "access_content",
    {
      description:
        "Access a paid endpoint on the IndiaMarkets API. If a UPI mandate is configured, payment happens automatically via the UPI-402 protocol. If not, returns the payment requirements so you can ask the user to set up a mandate.",
      inputSchema: {
        endpoint: z.string().describe("API endpoint path, e.g. /api/nifty, /api/stock/RELIANCE, /api/research, /api/signals"),
      },
    },
    async ({ endpoint }) => {
      const url = `${SAAS_BASE}${endpoint}`;

      if (!session.mandateRef) {
        const probe = await fetch(url);
        if (probe.status === 402) {
          const body = await probe.json();
          return {
            content: [{
              type: "text" as const,
              text: [
                `Payment required: Rs ${body.payment.amount} to ${body.payee.vpa}`,
                `Description: ${body.payment.description}`,
                "",
                "No UPI mandate configured. Ask the user to set one up using the setup_mandate tool.",
                "They need a UPI mandate reference (UMN) from their UPI app (PhonePe, GPay, Paytm, etc).",
                "",
                "For testing, any string works as a mandate ref (mock mode).",
              ].join("\n"),
            }],
          };
        }
        const data = await probe.json();
        return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
      }

      try {
        const res = await upi402Fetch(url, {
          mandateRef: session.mandateRef,
          privateKey: session.keyPair.privateKey,
        });

        if (res.status === 200) {
          const data = await res.json();
          if (res.upi402Receipt) {
            session.spending.push({
              endpoint,
              amount: res.upi402Receipt.amount,
              receipt: res.upi402Receipt,
              time: new Date().toISOString(),
            });
          }
          return {
            content: [{
              type: "text" as const,
              text: JSON.stringify(data, null, 2),
            }],
          };
        }

        const errBody = await res.json();
        return {
          content: [{
            type: "text" as const,
            text: `Payment failed (${res.status}): ${JSON.stringify(errBody)}`,
          }],
          isError: true,
        };
      } catch (err) {
        return {
          content: [{
            type: "text" as const,
            text: `Error: ${(err as Error).message}`,
          }],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    "setup_mandate",
    {
      description:
        "Configure the UPI mandate reference for automatic payments. The user provides their UPI mandate ref (UMN) from any UPI app. In test/mock mode, any string works.",
      inputSchema: {
        mandate_ref: z.string().describe("UPI Unique Mandate Number (UMN). For testing, use any string like 'MY-MANDATE-001'."),
      },
    },
    async ({ mandate_ref }) => {
      session.mandateRef = mandate_ref;
      return {
        content: [{
          type: "text" as const,
          text: [
            `Mandate configured: ${mandate_ref}`,
            "",
            "All subsequent access_content calls will auto-pay using this mandate.",
            "Payments are signed with Ed25519 — the server can only charge the exact agreed amount.",
            "",
            `Session public key: ${session.keyPair.publicKey.slice(0, 30)}...`,
          ].join("\n"),
        }],
      };
    },
  );

  server.registerTool(
    "get_spending",
    {
      description: "Show all payments made in this session — endpoints accessed, amounts paid, receipts.",
      inputSchema: {},
    },
    async () => {
      if (session.spending.length === 0) {
        return {
          content: [{ type: "text" as const, text: "No payments made yet." }],
        };
      }

      const total = session.spending.reduce((s, x) => s + x.amount, 0);
      const lines = [
        `Total spent: Rs ${total} across ${session.spending.length} payment(s)`,
        `Mandate: ${session.mandateRef}`,
        "",
        ...session.spending.map((s, i) =>
          `${i + 1}. ${s.endpoint} — Rs ${s.amount} — ${s.receipt.txnId} — ${s.time}`
        ),
      ];

      return {
        content: [{ type: "text" as const, text: lines.join("\n") }],
      };
    },
  );

  return server;
}

export function startMcpServer(port: number): Promise<ReturnType<typeof express.application.listen>> {
  const app = express();
  app.use(express.json());

  const transports: Record<string, StreamableHTTPServerTransport> = {};

  app.post("/mcp", async (req, res) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    try {
      if (sessionId && transports[sessionId]) {
        await transports[sessionId]!.handleRequest(req, res, req.body);
        return;
      }
      if (!sessionId && isInitializeRequest(req.body)) {
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (sid: string) => {
            transports[sid] = transport;
          },
        });
        transport.onclose = () => {
          const sid = transport.sessionId;
          if (sid && transports[sid]) delete transports[sid];
        };
        const server = createMcpServer();
        await server.connect(transport);
        await transport.handleRequest(req, res, req.body);
        return;
      }
      res.status(400).json({
        jsonrpc: "2.0",
        error: { code: -32000, message: "Bad Request: No valid session ID" },
        id: null,
      });
    } catch (error) {
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal server error" },
          id: null,
        });
      }
    }
  });

  app.get("/mcp", async (req, res) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    if (!sessionId || !transports[sessionId]) {
      res.status(400).send("Invalid or missing session ID");
      return;
    }
    await transports[sessionId]!.handleRequest(req, res);
  });

  app.delete("/mcp", async (req, res) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    if (sessionId && transports[sessionId]) {
      await transports[sessionId]!.close();
      delete transports[sessionId];
    }
    res.status(200).end();
  });

  return new Promise((resolve) => {
    const server = app.listen(port, "127.0.0.1", () => resolve(server));
  });
}
