import express from "express";
import { createServer as createViteServer } from "vite";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const UNISAT_BASE = "https://open-api.unisat.io";

async function fetchUnisat(pathname: string, apiKey: string) {
  const response = await fetch(`${UNISAT_BASE}${pathname}`, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json",
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body?.code) {
    throw new Error(body?.msg || `UniSat request failed with ${response.status}`);
  }
  return body?.data ?? body;
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // API route to track inscriptions in a JSON file
  app.post("/api/track", async (req, res) => {
    try {
      const inscription = req.body;
      const filePath = path.join(process.cwd(), "inscriptions.json");
      
      let inscriptions = [];
      try {
        const data = await fs.readFile(filePath, "utf-8");
        inscriptions = JSON.parse(data);
      } catch (err) {
        // File doesn't exist yet
      }

      inscriptions.push({
        ...inscription,
        trackedAt: new Date().toISOString()
      });

      await fs.writeFile(filePath, JSON.stringify(inscriptions, null, 2));

      res.json({ success: true });
    } catch (err: any) {
      console.error("Tracking error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/brc20/:ticker", async (req, res) => {
    const ticker = String(req.params.ticker || "").trim().toLowerCase();
    if (!/^[a-z0-9]{4}$/.test(ticker)) {
      res.status(400).json({ error: "BRC-20 ticker must be exactly 4 letters or numbers." });
      return;
    }

    const apiKey = process.env.UNISAT_API_KEY;
    if (!apiKey) {
      res.status(503).json({
        error: "UNISAT_API_KEY is not configured yet.",
        ticker,
        setupNeeded: true,
        source: "UniSat Open API",
        endpoints: [
          `/v1/indexer/brc20/${ticker}/info`,
          `/v1/indexer/brc20/${ticker}/holders?start=0&limit=8`,
        ],
      });
      return;
    }

    try {
      const [info, holders] = await Promise.all([
        fetchUnisat(`/v1/indexer/brc20/${encodeURIComponent(ticker)}/info`, apiKey),
        fetchUnisat(`/v1/indexer/brc20/${encodeURIComponent(ticker)}/holders?start=0&limit=8`, apiKey),
      ]);

      res.json({
        ticker,
        info,
        holders: Array.isArray(holders?.detail) ? holders.detail : Array.isArray(holders) ? holders : [],
        source: "UniSat Open API",
        endpoints: [
          `/v1/indexer/brc20/${ticker}/info`,
          `/v1/indexer/brc20/${ticker}/holders?start=0&limit=8`,
        ],
      });
    } catch (err: any) {
      res.status(502).json({ error: err.message || "Unable to load BRC-20 data from UniSat.", ticker });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
