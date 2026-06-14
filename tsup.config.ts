import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: {
      index: "src/index.ts",
      client: "src/client.ts",
      handler: "src/handler.ts",
      types: "src/types.ts",
      store: "src/store.ts",
      "verifiers/mock": "src/verifiers/mock.ts",
      "verifiers/razorpay": "src/verifiers/razorpay.ts",
    },
    format: ["esm", "cjs"],
    dts: true,
    clean: true,
    splitting: false,
    sourcemap: true,
  },
  {
    entry: { mcp: "src/mcp.ts" },
    format: ["esm"],
    dts: true,
    splitting: false,
    sourcemap: true,
    banner: { js: "#!/usr/bin/env node" },
    external: ["@modelcontextprotocol/sdk"],
  },
]);
