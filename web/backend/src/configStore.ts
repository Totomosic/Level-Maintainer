import fs from "node:fs/promises";

export interface ItemEntry {
  name: string;
  threshold: number | null;
  batchSize: number | null;
  fluidName: string | null;
  group: string | null;
}

interface ItemsBounds {
  assignmentStart: number;
  openBrace: number;
  closeBrace: number;
}

interface SleepBounds {
  valueStart: number;
  valueEnd: number;
  value: number;
}

function luaString(value: string): string {
  const escaped = value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return `"${escaped}"`;
}

function parseLuaString(value: string): string {
  return JSON.parse(value);
}

function splitTuple(value: string): string[] {
  const parts: string[] = [];
  let current = "";
  let inString = false;
  let escaped = false;

  for (const char of value) {
    if (inString) {
      current += char;
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === "\\") {
        escaped = true;
        continue;
      }
      if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      current += char;
      continue;
    }

    if (char === ",") {
      const trimmed = current.trim();
      if (trimmed.length > 0) {
        parts.push(trimmed);
      }
      current = "";
      continue;
    }

    current += char;
  }

  const tail = current.trim();
  if (tail.length > 0) {
    parts.push(tail);
  }

  return parts;
}

function parseScalar(value: string | undefined): number | string | null {
  if (!value || value === "nil") {
    return null;
  }

  if (/^-?\d+(\.\d+)?$/.test(value)) {
    return Number(value);
  }

  if (/^"(?:\\.|[^"\\])*"$/.test(value)) {
    return parseLuaString(value);
  }

  throw new Error(`Unsupported Lua value: ${value}`);
}

function findItemsBounds(content: string): ItemsBounds {
  const marker = 'cfg["items"]';
  const markerIndex = content.indexOf(marker);
  if (markerIndex === -1) {
    throw new Error('Could not find cfg["items"] in config file.');
  }

  const assignmentStart = markerIndex;
  const openBrace = content.indexOf("{", markerIndex);
  if (openBrace === -1) {
    throw new Error('Could not find opening brace for cfg["items"].');
  }

  let inString = false;
  let escaped = false;
  let depth = 0;

  for (let i = openBrace; i < content.length; i += 1) {
    const char = content[i];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === "{") {
      depth += 1;
      continue;
    }

    if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return { assignmentStart, openBrace, closeBrace: i };
      }
    }
  }

  throw new Error('Could not find closing brace for cfg["items"].');
}

function parseItemsBlock(itemsBlock: string): Record<string, ItemEntry> {
  const body = itemsBlock.slice(1, -1);
  const entries: Record<string, ItemEntry> = {};
  let currentGroup: string | null = null;

  for (const line of body.split(/\r?\n/)) {
    const groupMatch = /^\s*--\s*@group:\s*(.*?)\s*$/.exec(line);
    if (groupMatch) {
      const groupLabel = groupMatch[1].trim();
      currentGroup = groupLabel.length > 0 ? groupLabel : null;
      continue;
    }

    const entryMatch = /^\s*\["((?:\\.|[^"\\])*)"\]\s*=\s*\{([^}]*)\}\s*,?\s*(?:--.*)?$/.exec(line);
    if (!entryMatch) {
      continue;
    }

    const rawName = entryMatch[1];
    const rawTuple = entryMatch[2];
    const tupleParts = splitTuple(rawTuple);

    const threshold = parseScalar(tupleParts[0]);
    const batchSize = parseScalar(tupleParts[1]);
    const fluidName = parseScalar(tupleParts[2]);

    if (threshold !== null && typeof threshold !== "number") {
      throw new Error(`Invalid threshold for ${rawName}.`);
    }
    if (batchSize !== null && typeof batchSize !== "number") {
      throw new Error(`Invalid batch_size for ${rawName}.`);
    }
    if (fluidName !== null && typeof fluidName !== "string") {
      throw new Error(`Invalid fluid_name for ${rawName}.`);
    }

    const name = parseLuaString(`"${rawName}"`);
    entries[name] = {
      name,
      threshold,
      batchSize,
      fluidName,
      group: currentGroup,
    };
  }

  return entries;
}

function serializeItems(entries: Record<string, ItemEntry>): string {
  const groupedEntries = new Map<string | null, ItemEntry[]>();
  for (const entry of Object.values(entries)) {
    const key = entry.group;
    const groupItems = groupedEntries.get(key) ?? [];
    groupItems.push(entry);
    groupedEntries.set(key, groupItems);
  }

  const groupKeys = [...groupedEntries.keys()].sort((a, b) => {
    if (a === null) {
      return b === null ? 0 : -1;
    }
    if (b === null) {
      return 1;
    }
    return a.localeCompare(b);
  });

  let remainingEntries = Object.keys(entries).length;
  const lines: string[] = [];

  for (const key of groupKeys) {
    if (key !== null) {
      if (lines.length > 0) {
        lines.push("");
      }
      lines.push(`    -- @group: ${key}`);
    }

    const groupItems = (groupedEntries.get(key) ?? []).sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of groupItems) {
      const base = [
        entry.threshold === null ? "nil" : String(entry.threshold),
        entry.batchSize === null ? "nil" : String(entry.batchSize),
      ];

      if (entry.fluidName !== null) {
        base.push(luaString(entry.fluidName));
      }

      remainingEntries -= 1;
      const suffix = remainingEntries > 0 ? "," : "";
      lines.push(`    [${luaString(entry.name)}] = {${base.join(", ")}}${suffix}`);
    }
  }

  return `cfg["items"] = {\n${lines.join("\n")}${lines.length > 0 ? "\n" : ""}}`;
}

function replaceItems(content: string, entries: Record<string, ItemEntry>): string {
  const bounds = findItemsBounds(content);
  const replacement = serializeItems(entries);
  return content.slice(0, bounds.assignmentStart) + replacement + content.slice(bounds.closeBrace + 1);
}

function findSleepBounds(content: string): SleepBounds {
  const match = /cfg\["sleep"\]\s*=\s*(-?\d+(?:\.\d+)?)/.exec(content);
  if (!match || match.index === undefined) {
    throw new Error('Could not find cfg["sleep"] in config file.');
  }

  const valueLiteral = match[1];
  const fullMatch = match[0];
  const valueOffset = fullMatch.lastIndexOf(valueLiteral);
  const valueStart = match.index + valueOffset;
  const valueEnd = valueStart + valueLiteral.length;
  const value = Number(valueLiteral);

  if (!Number.isFinite(value)) {
    throw new Error("Invalid sleep value in config file.");
  }

  return { valueStart, valueEnd, value };
}

function replaceSleep(content: string, sleep: number): string {
  const bounds = findSleepBounds(content);
  return content.slice(0, bounds.valueStart) + String(sleep) + content.slice(bounds.valueEnd);
}

function validateEntry(entry: ItemEntry): void {
  if (!entry.name || entry.name.trim().length === 0) {
    throw new Error("name is required.");
  }

  if (entry.threshold !== null && !Number.isFinite(entry.threshold)) {
    throw new Error("threshold must be a number or null.");
  }

  if (entry.batchSize !== null && (!Number.isInteger(entry.batchSize) || entry.batchSize <= 0)) {
    throw new Error("batchSize must be a positive integer or null.");
  }

  if (entry.fluidName !== null && entry.fluidName.trim().length === 0) {
    throw new Error("fluidName cannot be an empty string.");
  }

  if (/^drop of\b/i.test(entry.name.trim()) && entry.fluidName === null) {
    throw new Error("fluidName is required when item name begins with 'drop of'.");
  }

  if (entry.group !== null) {
    if (entry.group.trim().length === 0) {
      throw new Error("group cannot be an empty string.");
    }

    if (/[\r\n]/.test(entry.group)) {
      throw new Error("group cannot contain newline characters.");
    }
  }
}

function validateSleep(sleep: number): void {
  if (!Number.isInteger(sleep) || sleep < 0) {
    throw new Error("sleep must be a non-negative integer.");
  }
}

function sortItems(entries: ItemEntry[]): ItemEntry[] {
  return entries.sort((a, b) => {
    const groupA = a.group ?? "";
    const groupB = b.group ?? "";
    const groupCompare = groupA.localeCompare(groupB);
    return groupCompare !== 0 ? groupCompare : a.name.localeCompare(b.name);
  });
}

export class ConfigStore {
  constructor(private readonly configPath: string) {}

  async readRawConfig(): Promise<string> {
    return fs.readFile(this.configPath, "utf8");
  }

  async listItems(): Promise<ItemEntry[]> {
    const raw = await this.readRawConfig();
    const bounds = findItemsBounds(raw);
    const block = raw.slice(bounds.openBrace, bounds.closeBrace + 1);
    const entries = parseItemsBlock(block);
    return sortItems(Object.values(entries));
  }

  async upsertItem(entry: ItemEntry): Promise<ItemEntry[]> {
    validateEntry(entry);

    const raw = await this.readRawConfig();
    const bounds = findItemsBounds(raw);
    const block = raw.slice(bounds.openBrace, bounds.closeBrace + 1);
    const entries = parseItemsBlock(block);

    entries[entry.name] = {
      name: entry.name,
      threshold: entry.threshold,
      batchSize: entry.batchSize,
      fluidName: entry.fluidName,
      group: entry.group === null ? null : entry.group.trim(),
    };

    const nextConfig = replaceItems(raw, entries);
    await fs.writeFile(this.configPath, nextConfig, "utf8");

    return sortItems(Object.values(entries));
  }

  async removeItem(name: string): Promise<ItemEntry[]> {
    if (!name || name.trim().length === 0) {
      throw new Error("name is required.");
    }

    const raw = await this.readRawConfig();
    const bounds = findItemsBounds(raw);
    const block = raw.slice(bounds.openBrace, bounds.closeBrace + 1);
    const entries = parseItemsBlock(block);

    if (!entries[name]) {
      throw new Error(`Item '${name}' does not exist.`);
    }

    delete entries[name];
    const nextConfig = replaceItems(raw, entries);
    await fs.writeFile(this.configPath, nextConfig, "utf8");

    return sortItems(Object.values(entries));
  }

  async getSleep(): Promise<number> {
    const raw = await this.readRawConfig();
    return findSleepBounds(raw).value;
  }

  async setSleep(sleep: number): Promise<number> {
    validateSleep(sleep);

    const raw = await this.readRawConfig();
    const nextConfig = replaceSleep(raw, sleep);
    await fs.writeFile(this.configPath, nextConfig, "utf8");
    return sleep;
  }
}
