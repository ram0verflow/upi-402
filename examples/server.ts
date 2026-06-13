import express from "express";
import { upi402 } from "../src/index.js";

const app = express();

app.get("/", (_req, res) => {
  res.json({
    endpoints: {
      "GET /api/data": "Protected. Costs 100 INR.",
      "GET /api/premium": "Protected. Costs 500 INR.",
      "GET /api/free": "Free. No payment needed.",
    },
  });
});

app.get(
  "/api/data",
  upi402({ vpa: "merchant@ybl", amount: 100, description: "Basic API access" }),
  (req, res) => {
    res.json({ data: "basic content", receipt: req.upi402?.receipt });
  },
);

app.get(
  "/api/premium",
  upi402({ vpa: "merchant@ybl", amount: 500, description: "Premium API access" }),
  (req, res) => {
    res.json({ data: "premium content", receipt: req.upi402?.receipt });
  },
);

app.get("/api/free", (_req, res) => {
  res.json({ data: "free content" });
});

app.listen(3000, () => {
  console.log("UPI-402 server running on http://localhost:3000");
  console.log("Try: curl http://localhost:3000/api/data");
});
