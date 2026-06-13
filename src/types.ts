import { z } from "zod";

export const UPI_402_VERSION = 1;

export const MandateFrequency = z.enum([
  "DAILY",
  "WEEKLY",
  "MONTHLY",
  "ON_DEMAND",
]);
export type MandateFrequency = z.infer<typeof MandateFrequency>;

export const PayeeSchema = z.object({
  vpa: z.string(),
  name: z.string(),
});

export const PaymentSchema = z.object({
  amount: z.number().positive(),
  currency: z.string().default("INR"),
  description: z.string().optional(),
});

export const MandateSchema = z.object({
  required: z.boolean().default(true),
  maxAmount: z.number().positive().optional(),
  frequency: MandateFrequency.optional(),
  validUntil: z.string().optional(),
  setupUrl: z.string().url().optional(),
});

export const ReceiptConfigSchema = z.object({
  endpoint: z.string().url().optional(),
});

export const UPI402ResponseSchema = z.object({
  upi402: z.literal(UPI_402_VERSION),
  payee: PayeeSchema,
  payment: PaymentSchema,
  mandate: MandateSchema.optional(),
  receipt: ReceiptConfigSchema.optional(),
  error: z.string().optional(),
});
export type UPI402Response = z.infer<typeof UPI402ResponseSchema>;

export interface UPI402Receipt {
  txnId: string;
  amount: number;
  currency: string;
  timestamp: string;
  umn: string;
  mock?: boolean;
}

export interface ParsedMandateAuth {
  umn: string;
  txnRef: string;
  [key: string]: string;
}

export type VerifyFunction = (
  mandateRef: string,
  amount: number,
  txnRef: string,
  metadata?: Record<string, unknown>,
) => Promise<VerifyResult>;

export interface VerifyResult {
  success: boolean;
  txnId?: string;
  error?: string;
  receipt?: Record<string, unknown>;
}

export interface UPI402MiddlewareOptions {
  vpa: string;
  name?: string;
  amount: number;
  currency?: string;
  description?: string;
  mandate?: {
    required?: boolean;
    maxAmount?: number;
    frequency?: MandateFrequency;
    validUntil?: string;
    setupUrl?: string;
  };
  verify?: VerifyFunction;
}

export interface UPI402FetchOptions {
  mandateRef: string;
  txnRef?: string;
  maxRetries?: number;
  onPaymentRequired?: (details: UPI402Response) => void;
  onPaymentComplete?: (receipt: UPI402Receipt) => void;
}

export interface UPI402FetchResponse extends Response {
  upi402Receipt?: UPI402Receipt;
}
