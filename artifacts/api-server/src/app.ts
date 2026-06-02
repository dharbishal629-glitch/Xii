import express from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import router from "./routes";
import { logger } from "./lib/logger";

const app = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());
app.use(express.json({ limit: "5mb" }));
app.use(express.urlencoded({ extended: true, limit: "5mb" }));

// API routes
app.use("/api", router);

// ── Static dashboard hosting ─────────────────────────────────────────────────
// When deployed, the dashboard's Vite build is served by Express so one
// service hosts both the API and the UI. We try both possible locations:
//   1. Bundled mode  → dist/public/   (after `node build.mjs`)
//   2. Source mode   → ../../dashboard/dist/public/  (when running via tsx)
const __filename = fileURLToPath(import.meta.url);
const __dirnameLocal = path.dirname(__filename);

const candidatePublicDirs = [
  path.resolve(__dirnameLocal, "public"),                                // bundled
  path.resolve(__dirnameLocal, "..", "dist", "public"),                  // bundled (from src/)
  path.resolve(__dirnameLocal, "..", "..", "dashboard", "dist", "public"), // source (tsx mode)
];

const publicDir = candidatePublicDirs.find((p) => fs.existsSync(path.join(p, "index.html")));

if (publicDir) {
  logger.info({ publicDir }, "Serving dashboard static files");
  app.use(
    express.static(publicDir, {
      index: false,
      maxAge: "1h",
      setHeaders(res, filePath) {
        if (/\/assets\//.test(filePath)) {
          res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        }
      },
    }),
  );
  // SPA catch-all: any non-API path returns index.html so React Router handles routing.
  app.get(/^\/(?!api\/)/, (_req, res) => {
    res.sendFile(path.join(publicDir, "index.html"));
  });
} else {
  logger.info("No dashboard build found — running in API-only mode");
  app.get("/", (_req, res) => {
    res.json({ status: "ok", service: "CTRL.PNL API", version: "2.0" });
  });
}

export default app;
