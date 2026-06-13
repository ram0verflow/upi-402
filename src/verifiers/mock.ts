import type { VerifyFunction, VerifyResult } from "../types.js";
import { createMockReceipt } from "../receipt.js";

interface MockVerifierOptions {
  simulatePending?: boolean;
}

export function mockVerifier(opts?: MockVerifierOptions): VerifyFunction {
  const calls = new Map<string, number>();

  return async (
    mandateRef: string,
    amount: number,
    txnRef: string,
  ): Promise<VerifyResult> => {
    if (opts?.simulatePending) {
      const key = `${mandateRef}:${txnRef}`;
      const count = (calls.get(key) ?? 0) + 1;
      calls.set(key, count);
      if (count === 1) {
        return { success: false, pending: true };
      }
    }

    const receipt = createMockReceipt(mandateRef, amount);
    return {
      success: true,
      txnId: receipt.txnId,
      receipt: receipt as unknown as Record<string, unknown>,
    };
  };
}
