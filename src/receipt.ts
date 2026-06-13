import { randomBytes } from "node:crypto";
import type { UPI402Receipt } from "./types.js";

export function createMockReceipt(
  umn: string,
  amount: number,
  currency = "INR",
): UPI402Receipt {
  return {
    txnId: `MOCK${randomBytes(8).toString("hex").toUpperCase()}`,
    amount,
    currency,
    timestamp: new Date().toISOString(),
    umn,
    mock: true,
  };
}

export function createReceipt(
  txnId: string,
  umn: string,
  amount: number,
  currency = "INR",
): UPI402Receipt {
  return {
    txnId,
    amount,
    currency,
    timestamp: new Date().toISOString(),
    umn,
  };
}
