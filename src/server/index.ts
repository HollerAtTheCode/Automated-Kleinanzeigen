import path from "node:path";
import crypto from "node:crypto";
import express from "express";
import multer from "multer";
import { createServer as createViteServer } from "vite";
import { config, hasOpenaiApiKey, setRuntimeOpenaiApiKey } from "./config.js";
import { analyzeProduct, generateDraft } from "./openaiClient.js";
import { recommendPrice } from "./pricing.js";
import { searchKleinanzeigen } from "./kleinanzeigen.js";
import { startPublishAssist } from "./publishAssist.js";
import { acceptsDeclaredImageType, assertValidUploadedImages, safeImageExtension } from "./uploads.js";
import { ProductAnalysisSchema, parseExcludedListingIds, parseSearchQueries } from "./validators.js";
import {
  addImages,
  createSession,
  getSession,
  publicSession,
  sessionUploadDir,
  setAnalysis,
  setComparables,
  setDraft
} from "./sessionStore.js";
import type { ComparableListing } from "../shared/types.js";
import type { StoredUploadedImage } from "./sessionStore.js";

const app = express();
app.use(express.json({ limit: "2mb" }));

function param(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

const upload = multer({
  storage: multer.diskStorage({
    destination: async (req, _file, cb) => {
      try {
        cb(null, await sessionUploadDir(param(req.params.id)));
      } catch (error) {
        cb(error as Error, "");
      }
    },
    filename: (_req, file, cb) => {
      const extension = safeImageExtension(file.originalname, file.mimetype);
      cb(null, `${crypto.randomUUID()}${extension}`);
    }
  }),
  limits: { fileSize: 12 * 1024 * 1024, files: 12 },
  fileFilter: (_req, file, cb) => {
    if (!acceptsDeclaredImageType(file.mimetype)) {
      cb(Object.assign(new Error("Unsupported image type."), { statusCode: 400 }));
      return;
    }
    cb(null, true);
  }
});

app.post("/api/session", async (_req, res, next) => {
  try {
    res.json(publicSession(await createSession()));
  } catch (error) {
    next(error);
  }
});

app.get("/api/settings", (_req, res) => {
  res.json({
    hasOpenaiApiKey: hasOpenaiApiKey(),
    openaiModel: config.openaiModel
  });
});

app.post("/api/settings/openai-key", (req, res, next) => {
  try {
    setRuntimeOpenaiApiKey(String(req.body?.apiKey ?? ""));
    res.json({ hasOpenaiApiKey: true, openaiModel: config.openaiModel });
  } catch (error) {
    next(error);
  }
});

app.get("/api/session/:id", (req, res, next) => {
  try {
    res.json(publicSession(getSession(param(req.params.id))));
  } catch (error) {
    next(error);
  }
});

app.post("/api/session/:id/images", upload.array("images"), async (req, res, next) => {
  try {
    const files = (req.files ?? []) as Express.Multer.File[];
    await assertValidUploadedImages(files);
    const images: StoredUploadedImage[] = files.map((file) => ({
      id: crypto.randomUUID(),
      filename: file.originalname,
      mimeType: file.mimetype,
      size: file.size,
      path: file.path
    }));
    res.json(publicSession(addImages(param(req.params.id), images)));
  } catch (error) {
    next(error);
  }
});

app.post("/api/session/:id/analyze", async (req, res, next) => {
  try {
    const session = getSession(param(req.params.id));
    const analysis = await analyzeProduct(session);
    res.json(setAnalysis(session.id, analysis).analysis);
  } catch (error) {
    next(error);
  }
});

app.post("/api/session/:id/analysis", (req, res, next) => {
  try {
    const session = getSession(param(req.params.id));
    const current = session.analysis ?? {};
    const result = ProductAnalysisSchema.parse({
      ...current,
      ...req.body,
      detectedAttributes: {
        ...(session.analysis?.detectedAttributes ?? {}),
        ...(typeof req.body?.detectedAttributes === "object" && req.body.detectedAttributes ? req.body.detectedAttributes : {})
      }
    });
    res.json(setAnalysis(session.id, result).analysis);
  } catch (error) {
    next(error);
  }
});

app.post("/api/session/:id/price-search", async (req, res, next) => {
  try {
    const session = getSession(param(req.params.id));
    const queries = parseSearchQueries(req.body?.queries, session.analysis?.searchQueries ?? []);
    const comparables = await searchKleinanzeigen(queries, session.analysis);
    res.json(setComparables(session.id, comparables).comparables);
  } catch (error) {
    next(error);
  }
});

app.post("/api/session/:id/draft", async (req, res, next) => {
  try {
    const session = getSession(param(req.params.id));
    const excludedIds = parseExcludedListingIds(req.body?.excludedListingIds);
    const comparables: ComparableListing[] = session.comparables.map((listing) => ({
      ...listing,
      excluded: excludedIds.has(listing.id)
    }));
    setComparables(session.id, comparables);
    const price = recommendPrice(comparables);
    const draft = await generateDraft(session, price);
    res.json(setDraft(session.id, draft).draft);
  } catch (error) {
    next(error);
  }
});

app.post("/api/session/:id/publish-assist", async (req, res, next) => {
  try {
    const session = getSession(param(req.params.id));
    if (!session.draft) {
      res.status(400).json({ error: "Die Anzeige muss zuerst vorbereitet werden." });
      return;
    }
    const state = await startPublishAssist(session.draft);
    session.publishAssist = state;
    res.json(state);
  } catch (error) {
    next(error);
  }
});

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const statusCode =
    error instanceof multer.MulterError
      ? 400
      : typeof error === "object" && error && "statusCode" in error
        ? Number(error.statusCode)
        : 500;
  res.status(Number.isFinite(statusCode) ? statusCode : 500).json({
    error: error instanceof multer.MulterError ? "Invalid image upload." : error instanceof Error ? error.message : "Unexpected server error"
  });
});

if (process.env.NODE_ENV !== "production") {
  const vite = await createViteServer({
    server: { middlewareMode: true },
    appType: "spa",
    root: config.rootDir
  });
  app.use(vite.middlewares);
} else {
  app.use(express.static(path.join(config.rootDir, "dist/client")));
  app.get(/.*/, (_req, res) => res.sendFile(path.join(config.rootDir, "dist/client/index.html")));
}

app.listen(config.port, config.host, () => {
  console.log(`Automated Kleinanzeigen läuft auf http://${config.host}:${config.port}`);
});
