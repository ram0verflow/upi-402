import { describe, it, expect } from "vitest";
import { parseMandateAuth, parseUPI402Response, parseReceiptHeader } from "../src/parse.js";

describe("parseMandateAuth", () => {
  it("parses a valid UPI-Mandate header", () => {
    const result = parseMandateAuth("UPI-Mandate umn=ABCD1234&txnRef=TXN789");
    expect(result).toEqual({ umn: "ABCD1234", txnRef: "TXN789" });
  });

  it("returns null for non-UPI-Mandate scheme", () => {
    expect(parseMandateAuth("Bearer token123")).toBeNull();
  });

  it("returns null for missing umn", () => {
    expect(parseMandateAuth("UPI-Mandate txnRef=TXN789")).toBeNull();
  });

  it("returns null for missing txnRef", () => {
    expect(parseMandateAuth("UPI-Mandate umn=ABCD1234")).toBeNull();
  });

  it("preserves unknown fields (forward compat)", () => {
    const result = parseMandateAuth("UPI-Mandate umn=ABC&txnRef=TX1&agent=did:web:foo&grant=eyJhbG");
    expect(result).toEqual({
      umn: "ABC",
      txnRef: "TX1",
      agent: "did:web:foo",
      grant: "eyJhbG",
    });
  });

  it("handles URL-encoded values", () => {
    const result = parseMandateAuth("UPI-Mandate umn=ABC%20DEF&txnRef=TX%2F1");
    expect(result).toEqual({ umn: "ABC DEF", txnRef: "TX/1" });
  });
});

describe("parseUPI402Response", () => {
  it("parses a valid 402 body", () => {
    const body = {
      upi402: 1,
      payee: { vpa: "merchant@ybl", name: "Test" },
      payment: { amount: 500, currency: "INR" },
    };
    const result = parseUPI402Response(body);
    expect(result).toBeTruthy();
    expect(result!.payee.vpa).toBe("merchant@ybl");
    expect(result!.payment.amount).toBe(500);
  });

  it("returns null for wrong version", () => {
    const body = {
      upi402: 2,
      payee: { vpa: "m@y", name: "T" },
      payment: { amount: 1 },
    };
    expect(parseUPI402Response(body)).toBeNull();
  });

  it("returns null for missing payee", () => {
    expect(parseUPI402Response({ upi402: 1, payment: { amount: 1 } })).toBeNull();
  });
});

describe("parseReceiptHeader", () => {
  it("parses valid JSON receipt", () => {
    const receipt = JSON.stringify({ txnId: "UPI123", amount: 500, timestamp: "2026-01-01T00:00:00Z", umn: "ABC" });
    const result = parseReceiptHeader(receipt);
    expect(result!.txnId).toBe("UPI123");
  });

  it("returns null for invalid JSON", () => {
    expect(parseReceiptHeader("not json")).toBeNull();
  });
});
