import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    client: "src/client.ts",
    types: "src/types.ts",
    store: "src/store.ts",
    "verifiers/mock": "src/verifiers/mock.ts",
    "verifiers/razorpay": "src/verifiers/razorpay.ts",
    "verifiers/phonepe": "src/verifiers/phonepe.ts",
    "verifiers/cashfree": "src/verifiers/cashfree.ts",
    "verifiers/stripe": "src/verifiers/stripe.ts",
  },
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
  splitting: false,
  sourcemap: true,
});
