import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as z from "zod";
import { upi402Fetch } from "../../src/client.js";
import { generateKeyPair } from "../../src/signing.js";
import type { UPI402Receipt } from "../../src/types.js";

const SAAS = "http://127.0.0.1:4402";

const STORE_DIR = join(homedir(), ".upi-402");
const STORE_PATH = join(STORE_DIR, "mandates.json");

interface StoredData {
  mandates: Record<string, string>;
  keyPair: { publicKey: string; privateKey: string };
}

function loadStore(): StoredData {
  try {
    return JSON.parse(readFileSync(STORE_PATH, "utf-8"));
  } catch {
    const data: StoredData = { mandates: {}, keyPair: generateKeyPair() };
    saveStore(data);
    return data;
  }
}

function saveStore(data: StoredData): void {
  mkdirSync(STORE_DIR, { recursive: true });
  writeFileSync(STORE_PATH, JSON.stringify(data, null, 2));
}

const store = loadStore();

const session = {
  get mandateRef(): string | null {
    return store.mandates[SAAS] ?? null;
  },
  set mandateRef(ref: string | null) {
    if (ref) {
      store.mandates[SAAS] = ref;
    } else {
      delete store.mandates[SAAS];
    }
    saveStore(store);
  },
  keyPair: store.keyPair,
  spending: [] as Array<{ endpoint: string; amount: number; receipt: UPI402Receipt; time: string }>,
};

const server = new McpServer({
  name: "upi-402-agent",
  version: "0.1.0",
});

server.registerTool(
  "browse_service",
  {
    description: "Browse the IndiaMarkets API. Shows endpoints, prices, and mandate setup flow.",
    inputSchema: {},
  },
  async () => {
    const res = await fetch(SAAS);
    return { content: [{ type: "text" as const, text: JSON.stringify(await res.json(), null, 2) }] };
  },
);

server.registerTool(
  "create_mandate",
  {
    description:
      "Step 1 of mandate setup. Creates a UPI autopay subscription for the user. Collects their name, email, and phone. After this, call authorize_mandate to get the UPI approval link.",
    inputSchema: {
      name: z.string().describe("Customer full name"),
      email: z.string().describe("Customer email"),
      phone: z.string().describe("Customer phone (Indian, with +91)"),
    },
  },
  async ({ name, email, phone }) => {
    const res = await fetch(`${SAAS}/mandate/create`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, email, phone }),
    });
    const data = (await res.json()) as Record<string, unknown>;

    if (!res.ok) {
      return { content: [{ type: "text" as const, text: `Failed: ${JSON.stringify(data)}` }], isError: true };
    }

    session.mandateRef = data.subscription_id as string;

    return {
      content: [{
        type: "text" as const,
        text: [
          `Mandate created: ${data.subscription_id}`,
          `Status: ${data.status}`,
          "",
          "Next: call authorize_mandate to get the UPI approval link for the user.",
        ].join("\n"),
      }],
    };
  },
);

server.registerTool(
  "authorize_mandate",
  {
    description:
      "Step 2 of mandate setup. Generates a UPI authorization link. The user must open this link to approve the mandate in their UPI app (PhonePe, GPay, etc). In sandbox mode, it opens a simulator.",
    inputSchema: {},
  },
  async () => {
    if (!session.mandateRef) {
      return { content: [{ type: "text" as const, text: "No mandate created yet. Call create_mandate first." }] };
    }

    const res = await fetch(`${SAAS}/mandate/authorize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subscription_id: session.mandateRef }),
    });
    const data = (await res.json()) as Record<string, unknown>;

    if (!res.ok) {
      return { content: [{ type: "text" as const, text: `Failed: ${JSON.stringify(data)}` }], isError: true };
    }

    return {
      content: [{
        type: "text" as const,
        text: [
          `Authorization link generated for ${session.mandateRef}`,
          "",
          `Open this link to approve the mandate:`,
          data.authorize_url as string,
          "",
          "After approving, call check_mandate_status to confirm it's active.",
        ].join("\n"),
      }],
    };
  },
);

server.registerTool(
  "check_mandate_status",
  {
    description: "Check if the user's UPI mandate has been authorized. Call after the user approves via the authorization link.",
    inputSchema: {},
  },
  async () => {
    if (!session.mandateRef) {
      return { content: [{ type: "text" as const, text: "No mandate created yet." }] };
    }

    const res = await fetch(`${SAAS}/mandate/status/${session.mandateRef}`);
    const data = (await res.json()) as Record<string, unknown>;

    return {
      content: [{
        type: "text" as const,
        text: [
          `Subscription: ${data.subscription_id}`,
          `Status: ${data.status}`,
          `Authorization: ${data.authorization_status ?? "PENDING"}`,
          `Ready for payments: ${data.ready}`,
          "",
          data.ready
            ? "Mandate is active. All access_content calls will now auto-pay."
            : "Not yet authorized. The user needs to approve via the authorization link.",
        ].join("\n"),
      }],
    };
  },
);

server.registerTool(
  "access_content",
  {
    description:
      "Access a paid endpoint on IndiaMarkets. Auto-pays if mandate is active. If no mandate exists, tells you to set one up.",
    inputSchema: {
      endpoint: z.string().describe("API path: /api/nifty, /api/stock/RELIANCE, /api/research, /api/signals"),
    },
  },
  async ({ endpoint }) => {
    const url = `${SAAS}${endpoint}`;

    if (!session.mandateRef) {
      const probe = await fetch(url);
      if (probe.status === 402) {
        const body = (await probe.json()) as Record<string, unknown>;
        const payment = body.payment as Record<string, unknown>;
        return {
          content: [{
            type: "text" as const,
            text: [
              `Payment required: Rs ${payment.amount} to ${(body.payee as Record<string, unknown>).vpa}`,
              "",
              "No mandate set up. Ask the user for their name, email, and phone,",
              "then call create_mandate followed by authorize_mandate.",
            ].join("\n"),
          }],
        };
      }
      return { content: [{ type: "text" as const, text: JSON.stringify(await probe.json(), null, 2) }] };
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
        return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
      }

      return {
        content: [{ type: "text" as const, text: `Failed (${res.status}): ${await res.text()}` }],
        isError: true,
      };
    } catch (err) {
      return {
        content: [{ type: "text" as const, text: `Payment error: ${(err as Error).message}` }],
        isError: true,
      };
    }
  },
);

server.registerTool(
  "get_spending",
  {
    description: "Show all payments made this session.",
    inputSchema: {},
  },
  async () => {
    if (session.spending.length === 0) {
      return { content: [{ type: "text" as const, text: "No payments yet." }] };
    }
    const total = session.spending.reduce((s, x) => s + x.amount, 0);
    const lines = [
      `Total: Rs ${total} across ${session.spending.length} payment(s)`,
      `Mandate: ${session.mandateRef}`,
      "",
      ...session.spending.map((s, i) =>
        `${i + 1}. ${s.endpoint} — Rs ${s.amount} — ${s.receipt.txnId} — ${s.time}`
      ),
    ];
    return { content: [{ type: "text" as const, text: lines.join("\n") }] };
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
