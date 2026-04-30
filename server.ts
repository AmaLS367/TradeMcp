import "dotenv/config";
import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import cors from "cors";
import { rateLimit } from "express-rate-limit";
import { db, mcpRouter, mcpWellKnownRouter } from "./src/server/mcp.js";
import { validateExchangeKeys } from "./src/server/exchangeValidator.js";
import { logger } from "./src/server/logger.js";

import { validateEnv } from "./src/server/env.js";

async function checkFirebaseConnection() {
  try {
    await db.collection('health_check').limit(1).get();
    return { ok: true };
  } catch (error: any) {
    return { ok: false, error: error.message };
  }
}

async function startServer() {
  // Validate environment variables before doing anything else
  validateEnv();

  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  // Logging middleware
  app.use((req, res, next) => {
    logger.info({ method: req.method, url: req.url }, 'Incoming request');
    next();
  });

  // Security Middlewares
  app.use(cors()); // Configure CORS as needed, default allows all origins
  app.use(express.json());

  // Rate Limiting
  const generalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    limit: 100, // Limit each IP to 100 requests per window
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'Too many requests, please try again later.' }
  });

  const strictLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    limit: 10, // Limit each IP to 10 key validation attempts per window
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { valid: false, error: 'Too many validation attempts. Please try again later.' }
  });

  // Apply general limiter to all /api routes
  app.use("/api/", generalLimiter);

  // API routes
  app.get("/api/health", async (req, res) => {
    const encryptionKey = process.env.ENCRYPTION_KEY || "";
    const firebaseStatus = await checkFirebaseConnection();
    
    res.json({
      status: firebaseStatus.ok ? "ok" : "error",
      firebase: firebaseStatus,
      config: {
        encryptionKeyConfigured: encryptionKey.length === 64,
        firebaseAdminCredentialsConfigured: Boolean(
          process.env.FIREBASE_SERVICE_ACCOUNT_KEY || process.env.GOOGLE_APPLICATION_CREDENTIALS
        ),
      },
    });
  });
  
  // Endpoint для валидации API ключей бирж
  app.post("/api/validate-keys", strictLimiter, async (req, res) => {
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
      logger.error({ error, exchange: req.body.exchange }, 'Ошибка при валидации ключей');
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

  app.listen(PORT, "0.0.0.0", async () => {
    logger.info(`Server running on http://0.0.0.0:${PORT}`);
    
    // Startup health check
    const firebaseStatus = await checkFirebaseConnection();
    if (firebaseStatus.ok) {
      logger.info('Firebase connection: OK');
    } else {
      logger.error({ error: firebaseStatus.error }, 'Firebase connection: FAILED');
    }
  });
}

startServer();
