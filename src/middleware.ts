import type { Request as ExpressReq, Response, NextFunction } from "express";
import type { UPI402Receipt } from "./types.js";
import { handleUPI402, type UPI402Options } from "./handler.js";

declare global {
  namespace Express {
    interface Request {
      upi402?: { receipt: UPI402Receipt };
    }
  }
}

function toWebRequest(req: ExpressReq): Request {
  const protocol = req.protocol || "http";
  const host = req.get("host") || "localhost";
  const url = `${protocol}://${host}${req.originalUrl}`;
  const headers = new Headers();
  for (const [key, val] of Object.entries(req.headers)) {
    if (typeof val === "string") headers.set(key, val);
  }
  return new Request(url, { method: req.method, headers });
}

export function upi402(opts: UPI402Options) {
  return async (req: ExpressReq, res: Response, next: NextFunction) => {
    const result = await handleUPI402(toWebRequest(req), opts);

    if (result.action === "payment_confirmed") {
      if (result.receipt) req.upi402 = { receipt: result.receipt };
      res.setHeader("X-UPI-402-Receipt", JSON.stringify(result.receipt));
      return next();
    }

    if (result.response) {
      res.status(result.response.status);
      result.response.headers.forEach((v, k) => res.setHeader(k, v));
      const body = await result.response.json();
      res.json(body);
      return;
    }

    res.status(500).json({ error: "unexpected handler state" });
  };
}
