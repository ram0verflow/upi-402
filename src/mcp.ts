#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as z from "zod";
import { upi402Fetch } from "./client.js";
import { generateKeyPair, derivePublicKey } from "./signing.js";

const mandateRef = process.env["UPI402_MANDATE_REF"];
const privateKey = process.env["UPI402_PRIVATE_KEY"] ?? generateKeyPair().privateKey;

const server = new McpServer({
  name: "upi-402",
  version: "0.1.0",
});

server.registerTool(
  "pay_upi402_endpoint",
  {
    description:
      "Access a UPI-402 protected HTTP endpoint. Automatically handles the 402 payment flow: discovers the price, pays with the configured UPI mandate, and returns the resource. Requires UPI402_MANDATE_REF env var.",
    inputSchema: {
      url: z.string().url().describe("The URL of the 402-protected endpoint"),
    },
  },
  async ({ url }) => {
    if (!mandateRef) {
      return {
        content: [{
          type: "text" as const,
          text: "UPI402_MANDATE_REF not configured. Set this environment variable to your UPI mandate reference (UMN).",
        }],
        isError: true,
      };
    }

    try {
      const res = await upi402Fetch(url, { mandateRef, privateKey });

      const headers: Record<string, string> = {};
      res.headers.forEach((v, k) => { headers[k] = v; });

      const body = await res.text();
      let parsed: unknown;
      try { parsed = JSON.parse(body); } catch { parsed = body; }

      const lines = [`Status: ${res.status}`];

      if (res.upi402Receipt) {
        lines.push(`Payment: Rs ${res.upi402Receipt.amount} (txn: ${res.upi402Receipt.txnId})`);
      }

      lines.push("", typeof parsed === "string" ? parsed : JSON.stringify(parsed, null, 2));

      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    } catch (err) {
      return {
        content: [{ type: "text" as const, text: `Payment failed: ${(err as Error).message}` }],
        isError: true,
      };
    }
  },
);

server.registerTool(
  "check_upi402_endpoint",
  {
    description:
      "Probe an HTTP endpoint to check if it uses UPI-402 payment protocol. Returns the price, merchant VPA, and payment requirements without paying.",
    inputSchema: {
      url: z.string().url().describe("The URL to probe"),
    },
  },
  async ({ url }) => {
    try {
      const res = await fetch(url);

      if (res.status !== 402) {
        return {
          content: [{
            type: "text" as const,
            text: `Not a 402 endpoint. Status: ${res.status}`,
          }],
        };
      }

      const body = await res.json();
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify(body, null, 2),
        }],
      };
    } catch (err) {
      return {
        content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }],
        isError: true,
      };
    }
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
