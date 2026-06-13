import { describe, it, expect } from "vitest";
import {
  generateKeyPair,
  signPayment,
  verifyPayment,
  derivePublicKey,
} from "../src/signing.js";

describe("signing", () => {
  const paymentId = "550e8400-e29b-41d4-a716-446655440000";
  const amount = 500;
  const merchantVpa = "merchant@ybl";
  const timestamp = 1718300000;

  it("generates a valid Ed25519 keypair", () => {
    const kp = generateKeyPair();
    expect(kp.publicKey).toBeTruthy();
    expect(kp.privateKey).toBeTruthy();
    expect(kp.publicKey).not.toBe(kp.privateKey);
  });

  it("derives public key from private key", () => {
    const kp = generateKeyPair();
    const derived = derivePublicKey(kp.privateKey);
    expect(derived).toBe(kp.publicKey);
  });

  it("signs and verifies a valid payment", () => {
    const kp = generateKeyPair();
    const sig = signPayment(kp.privateKey, paymentId, amount, merchantVpa, timestamp);
    expect(sig).toBeTruthy();

    const valid = verifyPayment(kp.publicKey, sig, paymentId, amount, merchantVpa, timestamp);
    expect(valid).toBe(true);
  });

  it("rejects signature with wrong amount", () => {
    const kp = generateKeyPair();
    const sig = signPayment(kp.privateKey, paymentId, 500, merchantVpa, timestamp);
    const valid = verifyPayment(kp.publicKey, sig, paymentId, 1000, merchantVpa, timestamp);
    expect(valid).toBe(false);
  });

  it("rejects signature with wrong paymentId", () => {
    const kp = generateKeyPair();
    const sig = signPayment(kp.privateKey, paymentId, amount, merchantVpa, timestamp);
    const valid = verifyPayment(kp.publicKey, sig, "different-id", amount, merchantVpa, timestamp);
    expect(valid).toBe(false);
  });

  it("rejects signature with wrong merchant VPA", () => {
    const kp = generateKeyPair();
    const sig = signPayment(kp.privateKey, paymentId, amount, merchantVpa, timestamp);
    const valid = verifyPayment(kp.publicKey, sig, paymentId, amount, "attacker@upi", timestamp);
    expect(valid).toBe(false);
  });

  it("rejects signature from a different key", () => {
    const kp1 = generateKeyPair();
    const kp2 = generateKeyPair();
    const sig = signPayment(kp1.privateKey, paymentId, amount, merchantVpa, timestamp);
    const valid = verifyPayment(kp2.publicKey, sig, paymentId, amount, merchantVpa, timestamp);
    expect(valid).toBe(false);
  });

  it("returns false for garbage signature", () => {
    const kp = generateKeyPair();
    const valid = verifyPayment(kp.publicKey, "not-a-real-signature", paymentId, amount, merchantVpa, timestamp);
    expect(valid).toBe(false);
  });
});
