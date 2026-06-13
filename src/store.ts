export interface PaymentIdStore {
  issue(paymentId: string): Promise<void>;
  consume(paymentId: string): Promise<boolean>;
}

const DEFAULT_TTL_MS = 5 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 60 * 1000;

interface Entry {
  issuedAt: number;
  consumed: boolean;
}

export class MemoryStore implements PaymentIdStore {
  private entries = new Map<string, Entry>();
  private timer: ReturnType<typeof setInterval>;

  constructor(private ttlMs = DEFAULT_TTL_MS) {
    this.timer = setInterval(() => this.cleanup(), CLEANUP_INTERVAL_MS);
    this.timer.unref();
  }

  async issue(paymentId: string): Promise<void> {
    this.entries.set(paymentId, { issuedAt: Date.now(), consumed: false });
  }

  async consume(paymentId: string): Promise<boolean> {
    const entry = this.entries.get(paymentId);
    if (!entry || entry.consumed) return false;
    if (Date.now() - entry.issuedAt > this.ttlMs) {
      this.entries.delete(paymentId);
      return false;
    }
    entry.consumed = true;
    return true;
  }

  destroy(): void {
    clearInterval(this.timer);
    this.entries.clear();
  }

  private cleanup(): void {
    const cutoff = Date.now() - this.ttlMs;
    for (const [id, entry] of this.entries) {
      if (entry.issuedAt < cutoff) this.entries.delete(id);
    }
  }
}
