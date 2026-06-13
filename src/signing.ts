import { generateKeyPairSync, sign, verify, createPublicKey, createPrivateKey } from "node:crypto";

export interface KeyPair {
  publicKey: string;
  privateKey: string;
}

export function generateKeyPair(): KeyPair {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519", {
    publicKeyEncoding: { type: "spki", format: "der" },
    privateKeyEncoding: { type: "pkcs8", format: "der" },
  });
  return {
    publicKey: publicKey.toString("base64"),
    privateKey: privateKey.toString("base64"),
  };
}

export function derivePublicKey(privateKeyB64: string): string {
  const key = createPrivateKey({
    key: Buffer.from(privateKeyB64, "base64"),
    format: "der",
    type: "pkcs8",
  });
  const pubKey = createPublicKey(key);
  return pubKey.export({ type: "spki", format: "der" }).toString("base64");
}

function buildMessage(
  paymentId: string,
  amount: number,
  merchantVpa: string,
  timestamp: number,
): Buffer {
  return Buffer.from(`${paymentId}:${amount}:${merchantVpa}:${timestamp}`);
}

export function signPayment(
  privateKeyB64: string,
  paymentId: string,
  amount: number,
  merchantVpa: string,
  timestamp: number,
): string {
  const key = createPrivateKey({
    key: Buffer.from(privateKeyB64, "base64"),
    format: "der",
    type: "pkcs8",
  });
  const message = buildMessage(paymentId, amount, merchantVpa, timestamp);
  const signature = sign(null, message, key);
  return signature.toString("base64");
}

export function verifyPayment(
  publicKeyB64: string,
  signatureB64: string,
  paymentId: string,
  amount: number,
  merchantVpa: string,
  timestamp: number,
): boolean {
  try {
    const key = createPublicKey({
      key: Buffer.from(publicKeyB64, "base64"),
      format: "der",
      type: "spki",
    });
    const message = buildMessage(paymentId, amount, merchantVpa, timestamp);
    return verify(null, message, key, Buffer.from(signatureB64, "base64"));
  } catch {
    return false;
  }
}
