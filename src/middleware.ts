import type { Request, Response, NextFunction } from "express";
import type { UPI402MiddlewareOptions, UPI402Receipt } from "./types.js";
import { createHandler } from "./handler.js";

declare global {
  namespace Express {
    interface Request {
      upi402?: { receipt: UPI402Receipt };
    }
  }
}

export function upi402(opts: UPI402MiddlewareOptions) {
  const handle = createHandler(opts);

  return async (req: Request, res: Response, next: NextFunction) => {
    const result = await handle({
      headers: req.headers as Record<string, string | undefined>,
    });

    if (result.proceed) {
      if (result.receipt) req.upi402 = { receipt: result.receipt };
      for (const [k, v] of Object.entries(result.headers)) res.setHeader(k, v);
      return next();
    }

    for (const [k, v] of Object.entries(result.headers)) res.setHeader(k, v);
    res.status(result.status).json(result.body);
  };
}
