import "dotenv/config";
import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { mcpRouter, mcpWellKnownRouter } from "./src/server/mcp.js";
import { validateExchangeKeys } from "./src/server/exchangeValidator.js";

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  app.use(express.json());

  // API routes
  app.get("/api/health", (req, res) => {
    const encryptionKey = process.env.ENCRYPTION_KEY || "";
    res.json({
      status: "ok",
      config: {
        encryptionKeyConfigured: encryptionKey.length === 64,
        firebaseAdminCredentialsConfigured: Boolean(
          process.env.FIREBASE_SERVICE_ACCOUNT_KEY || process.env.GOOGLE_APPLICATION_CREDENTIALS
        ),
      },
    });
  });
  
  // Endpoint для валидации API ключей бирж
  app.post("/api/validate-keys", async (req, res) => {
    try {
      const { exchange, apiKey, apiSecret } = req.body;

      if (!exchange || !apiKey || !apiSecret) {
        return res.status(400).json({
          valid: false,
          error: 'Необходимо указать exchange, apiKey и apiSecret',
        });
      }

      if (exchange !== 'binance' && exchange !== 'bybit') {
        return res.status(400).json({
          valid: false,
          error: 'Поддерживаются только binance и bybit',
        });
      }

      const result = await validateExchangeKeys(exchange, apiKey, apiSecret);
      res.json(result);
    } catch (error: any) {
      console.error('Ошибка при валидации ключей:', error);
      res.status(500).json({
        valid: false,
        error: 'Внутренняя ошибка сервера при валидации',
      });
    }
  });

  app.use(mcpWellKnownRouter);
  app.use("/api/mcp", mcpRouter);

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
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
