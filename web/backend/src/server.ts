import cors from "cors";
import express from "express";
import path from "node:path";

import { ConfigStore, ItemEntry } from "./configStore.js";

const app = express();
const port = Number(process.env.PORT ?? 3001);
const configPath = process.env.CONFIG_PATH ?? path.resolve(process.cwd(), "..", "..", "config.lua");
const store = new ConfigStore(configPath);

const SCALE_SUFFIXES: Record<string, number> = {
  k: 1_000,
  m: 1_000_000,
  g: 1_000_000_000,
  t: 1_000_000_000_000,
};

function parseScaledNumber(raw: string): number {
  const match = /^\s*([+-]?\d+(?:\.\d+)?)\s*([kKmMgGtT]?)\s*$/.exec(raw);
  if (!match) {
    throw new Error("Invalid number format. Use a number with optional suffix: k, m, g, t.");
  }

  const base = Number(match[1]);
  const suffix = match[2].toLowerCase();
  const multiplier = suffix.length > 0 ? SCALE_SUFFIXES[suffix] : 1;
  const value = base * multiplier;

  if (!Number.isFinite(value)) {
    throw new Error("Numeric value is too large.");
  }

  return value;
}

function asNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error("Numeric fields must be finite values.");
    }
    return value;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      return null;
    }
    return parseScaledNumber(trimmed);
  }

  throw new Error("Numeric fields must be a number, string, or null.");
}

function asRequiredNumber(value: unknown, fieldName: string): number {
  const parsed = asNullableNumber(value);
  if (parsed === null) {
    throw new Error(`${fieldName} is required.`);
  }
  return parsed;
}

function asNullableString(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value !== "string") {
    throw new Error("String fields must be a string or null.");
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asPriority(value: unknown): "standard" | "low" {
  const parsed = asNullableString(value);
  if (parsed === null) {
    return "standard";
  }

  const normalized = parsed.toLowerCase();
  if (normalized === "standard" || normalized === "low") {
    return normalized;
  }

  throw new Error("priority must be either 'standard' or 'low'.");
}

app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/config", async (_req, res, next) => {
  try {
    const rawConfig = await store.readRawConfig();
    res.type("text/plain").send(rawConfig);
  } catch (error) {
    next(error);
  }
});

app.get("/api/items", async (_req, res, next) => {
  try {
    const items = await store.listItems();
    res.json({ items });
  } catch (error) {
    next(error);
  }
});

app.get("/api/sleep", async (_req, res, next) => {
  try {
    const sleep = await store.getSleep();
    res.json({ sleep });
  } catch (error) {
    next(error);
  }
});

app.post("/api/items", async (req, res, next) => {
  try {
    const body = req.body as Record<string, unknown>;

    const item: ItemEntry = {
      name: String(body.name ?? "").trim(),
      threshold: asNullableNumber(body.threshold),
      batchSize: asNullableNumber(body.batchSize),
      fluidName: asNullableString(body.fluidName),
      priority: asPriority(body.priority),
      group: asNullableString(body.group),
    };

    const items = await store.upsertItem(item);
    res.status(201).json({ items });
  } catch (error) {
    next(error);
  }
});

app.put("/api/sleep", async (req, res, next) => {
  try {
    const body = req.body as Record<string, unknown>;
    const sleep = asRequiredNumber(body.sleep, "sleep");
    const updatedSleep = await store.setSleep(sleep);
    res.json({ sleep: updatedSleep });
  } catch (error) {
    next(error);
  }
});

app.delete("/api/items/:name", async (req, res, next) => {
  try {
    const name = req.params.name;
    const items = await store.removeItem(name);
    res.json({ items });
  } catch (error) {
    next(error);
  }
});

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const message = error instanceof Error ? error.message : "Unexpected server error.";
  res.status(400).json({ error: message });
});

app.listen(port, () => {
  console.log(`Level Maintainer backend listening on http://localhost:${port}`);
  console.log(`Using config file: ${configPath}`);
});
