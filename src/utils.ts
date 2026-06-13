import { randomBytes } from "node:crypto";

export function generateTxnRef(): string {
  return `TXN${Date.now().toString(36).toUpperCase()}${randomBytes(4).toString("hex").toUpperCase()}`;
}

export function formatMandateHeader(umn: string, txnRef: string): string {
  return `UPI-Mandate umn=${umn}&txnRef=${txnRef}`;
}
