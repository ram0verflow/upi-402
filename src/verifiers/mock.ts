import type { VerifyFunction, VerifyResult } from "../types.js";
import { createMockReceipt } from "../receipt.js";

export function mockVerifier(): VerifyFunction {
  return async (
    mandateRef: string,
    amount: number,
    _txnRef: string,
  ): Promise<VerifyResult> => {
    const receipt = createMockReceipt(mandateRef, amount);
    return {
      success: true,
      txnId: receipt.txnId,
      receipt: receipt as unknown as Record<string, unknown>,
    };
  };
}
