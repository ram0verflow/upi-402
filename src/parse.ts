import { UPI402ResponseSchema, type UPI402Response, type UPI402Receipt, type ParsedMandateAuth } from "./types.js";

export function parseMandateAuth(header: string): ParsedMandateAuth | null {
  if (!header.startsWith("UPI-Mandate ")) return null;

  const params = header.slice("UPI-Mandate ".length);
  const parsed: Record<string, string> = {};

  for (const pair of params.split("&")) {
    const eq = pair.indexOf("=");
    if (eq === -1) continue;
    const key = pair.slice(0, eq);
    const value = pair.slice(eq + 1);
    parsed[key] = decodeURIComponent(value);
  }

  if (!parsed["umn"] || !parsed["txnRef"]) return null;

  return parsed as ParsedMandateAuth;
}

export function parseUPI402Response(body: unknown): UPI402Response | null {
  const result = UPI402ResponseSchema.safeParse(body);
  return result.success ? result.data : null;
}

export function parseReceiptHeader(header: string): UPI402Receipt | null {
  try {
    return JSON.parse(header) as UPI402Receipt;
  } catch {
    return null;
  }
}
