import { startSaasServer } from "./saas-server.js";
import { startMcpServer } from "./mcp-server.js";

const SAAS_PORT = 4402;
const MCP_PORT = 4403;

async function main() {
  console.log("=== UPI-402 MCP Demo ===\n");

  await startSaasServer(SAAS_PORT);
  console.log(`IndiaMarkets API:  http://127.0.0.1:${SAAS_PORT}`);

  await startMcpServer(MCP_PORT);
  console.log(`MCP endpoint:      http://127.0.0.1:${MCP_PORT}/mcp`);

  console.log(`\nAdd to Claude Desktop config (claude_desktop_config.json):`);
  console.log(JSON.stringify({
    mcpServers: {
      "upi-402-demo": {
        url: `http://127.0.0.1:${MCP_PORT}/mcp`,
      },
    },
  }, null, 2));

  console.log("\nThen ask Claude:");
  console.log('  "What services are available on the IndiaMarkets API?"');
  console.log('  "Show me the Nifty 50 data"');
  console.log('  "Get me a research report"');
  console.log("\nClaude will discover the 402 paywall and ask you to set up a mandate.");
  console.log("Once set up, all subsequent requests auto-pay.\n");
}

main().catch(console.error);
