import express from "express";
import { createServer as createViteServer } from "vite";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

      // If registered, also add to registry.json
      if (inscription.registered) {
        const registryPath = path.join(process.cwd(), "registry.json");
        let registry = [];
        try {
          const regData = await fs.readFile(registryPath, "utf-8");
          registry = JSON.parse(regData);
        } catch (err) {}
        registry.push({
          ...inscription,
          registeredAt: new Date().toISOString()
        });
        await fs.writeFile(registryPath, JSON.stringify(registry, null, 2));
      }

      res.json({ success: true });
    } catch (err: any) {
      console.error("Tracking error:", err);
      res.status(500).json({ error: err.message });
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
