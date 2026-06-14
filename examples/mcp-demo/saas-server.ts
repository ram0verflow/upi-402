import express from "express";
import { upi402 } from "../../src/index.js";

export function startSaasServer(port: number): Promise<ReturnType<typeof express.application.listen>> {
  const app = express();

  app.get("/", (_req, res) => {
    res.json({
      service: "IndiaMarkets API",
      description: "Real-time Indian market data, research reports, and trading signals",
      endpoints: [
        { path: "/api/nifty", price: "Rs 5", description: "Live Nifty 50 index data" },
        { path: "/api/stock/:symbol", price: "Rs 10", description: "Stock quote + fundamentals" },
        { path: "/api/research", price: "Rs 50", description: "Daily market research report" },
        { path: "/api/signals", price: "Rs 100", description: "AI-generated trading signals" },
      ],
      payment: "UPI-402 protocol. Send Authorization: UPI-Mandate header with your mandate ref.",
    });
  });

  app.get(
    "/api/nifty",
    upi402({ vpa: "indiamarkets@ybl", amount: 5, description: "Nifty 50 live data" }),
    (_req, res) => {
      res.json({
        index: "NIFTY 50",
        value: 23842.15 + Math.random() * 100,
        change: +(Math.random() * 2 - 1).toFixed(2),
        timestamp: new Date().toISOString(),
        components: [
          { symbol: "RELIANCE", price: 2891.5, weight: 10.2 },
          { symbol: "TCS", price: 3456.8, weight: 5.1 },
          { symbol: "HDFCBANK", price: 1623.4, weight: 8.7 },
        ],
        receipt: _req.upi402?.receipt,
      });
    },
  );

  app.get(
    "/api/stock/:symbol",
    upi402({ vpa: "indiamarkets@ybl", amount: 10, description: "Stock quote + fundamentals" }),
    (req, res) => {
      const symbol = req.params.symbol?.toUpperCase() ?? "UNKNOWN";
      res.json({
        symbol,
        price: +(Math.random() * 5000 + 100).toFixed(2),
        change: +(Math.random() * 4 - 2).toFixed(2),
        volume: Math.floor(Math.random() * 10000000),
        pe_ratio: +(Math.random() * 40 + 5).toFixed(1),
        market_cap: `Rs ${Math.floor(Math.random() * 500000 + 10000)} Cr`,
        recommendation: ["BUY", "HOLD", "SELL"][Math.floor(Math.random() * 3)],
        timestamp: new Date().toISOString(),
        receipt: req.upi402?.receipt,
      });
    },
  );

  app.get(
    "/api/research",
    upi402({ vpa: "indiamarkets@ybl", amount: 50, description: "Daily market research report" }),
    (_req, res) => {
      res.json({
        title: "India Markets Daily Brief",
        date: new Date().toISOString().split("T")[0],
        summary: "Markets traded higher amid global cues. FII inflows remained positive. Banking stocks led the rally.",
        key_levels: { nifty_support: 23500, nifty_resistance: 24200 },
        top_picks: ["HDFCBANK", "INFY", "SUNPHARMA", "BAJFINANCE"],
        receipt: _req.upi402?.receipt,
      });
    },
  );

  app.get(
    "/api/signals",
    upi402({ vpa: "indiamarkets@ybl", amount: 100, description: "AI trading signals" }),
    (_req, res) => {
      res.json({
        generated_at: new Date().toISOString(),
        signals: [
          { symbol: "RELIANCE", action: "BUY", entry: 2850, target: 3100, stop_loss: 2750, confidence: 0.82 },
          { symbol: "TCS", action: "HOLD", target: 3600, stop_loss: 3300, confidence: 0.71 },
          { symbol: "TATAMOTORS", action: "BUY", entry: 780, target: 880, stop_loss: 740, confidence: 0.76 },
        ],
        receipt: _req.upi402?.receipt,
      });
    },
  );

  return new Promise((resolve) => {
    const server = app.listen(port, "127.0.0.1", () => resolve(server));
  });
}
