import type { UPI402Response } from "./types.js";

export class UPI402Error extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = "UPI402Error";
  }
}

export class UPI402PaymentError extends UPI402Error {
  constructor(
    message: string,
    public readonly details: UPI402Response,
  ) {
    super(message, details.error ?? "payment_required");
    this.name = "UPI402PaymentError";
  }
}
