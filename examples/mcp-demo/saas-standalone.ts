import { startSaasServer } from "./saas-server.js";

const PORT = 4402;
await startSaasServer(PORT);
console.log(`IndiaMarkets API running on http://127.0.0.1:${PORT}`);
console.log("Keep this running while using Claude Desktop.\n");
