<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";

interface ItemEntry {
  name: string;
  threshold: number | null;
  batchSize: number | null;
  fluidName: string | null;
  priority: "standard" | "low";
  group: string | null;
}

interface ItemEditDraft {
  name: string;
  threshold: string;
  batchSize: string;
  fluidName: string;
  priority: "standard" | "low";
  group: string;
}

interface ItemGroupSection {
  key: string;
  label: string;
  items: ItemEntry[];
}

interface NumberSuffix {
  divisor: number;
  suffix: string;
}

interface ItemPayload {
  name: string;
  threshold: string;
  batchSize: string;
  fluidName: string | null;
  priority: "standard" | "low";
  group: string | null;
}

interface NamingSuggestion {
  field: "name" | "fluidName";
  current: string;
  suggested: string;
}

type EntryMode = "item" | "fluid";

interface NamingWarningState {
  context: "add" | "inline";
  originalName: string | null;
  mode: EntryMode;
  payload: ItemPayload;
  suggestions: NamingSuggestion[];
}

const items = ref<ItemEntry[]>([]);
const configPreview = ref("");
const loading = ref(false);
const submitting = ref(false);
const savingSleep = ref(false);
const savingInline = ref(false);
const movingGroupItemName = ref<string | null>(null);
const error = ref("");
const sleepInput = ref("");
const editingOriginalName = ref<string | null>(null);
const namingWarning = ref<NamingWarningState | null>(null);
const formMode = ref<EntryMode>("item");
const inlineMode = ref<EntryMode>("item");
const stoneDustIcon = new URL("../icons/stone_dust.png", import.meta.url).href;

const form = reactive({
  name: "",
  threshold: "",
  batchSize: "1",
  fluidName: "",
  priority: "standard" as "standard" | "low",
  group: "",
});

const inlineDraft = reactive<ItemEditDraft>({
  name: "",
  threshold: "",
  batchSize: "",
  fluidName: "",
  priority: "standard",
  group: "",
});

const canSubmit = computed(
  () =>
    form.name.trim().length > 0 &&
    form.batchSize.trim().length > 0 &&
    (formMode.value === "item" || form.fluidName.trim().length > 0),
);
const availableGroups = computed(() => {
  const groups = new Set<string>();
  for (const item of items.value) {
    if (item.group !== null && item.group.trim().length > 0) {
      groups.add(item.group);
    }
  }
  return [...groups].sort((a, b) => a.localeCompare(b));
});
const groupedItems = computed<ItemGroupSection[]>(() => {
  const map = new Map<string | null, ItemEntry[]>();
  for (const item of items.value) {
    const key = item.group !== null && item.group.trim().length > 0 ? item.group : null;
    const groupItems = map.get(key) ?? [];
    groupItems.push(item);
    map.set(key, groupItems);
  }

  const orderedKeys = [...map.keys()].sort((a, b) => {
    if (a === null) {
      return b === null ? 0 : 1;
    }
    if (b === null) {
      return -1;
    }
    return a.localeCompare(b);
  });

  return orderedKeys.map((key) => {
    const groupItems = (map.get(key) ?? []).sort((a, b) => a.name.localeCompare(b.name));
    return {
      key: key ?? "__ungrouped__",
      label: key ?? "Ungrouped",
      items: groupItems,
    };
  });
});

const NUMBER_SUFFIXES: NumberSuffix[] = [
  { divisor: 1_000_000_000_000, suffix: "t" },
  { divisor: 1_000_000_000, suffix: "g" },
  { divisor: 1_000_000, suffix: "m" },
  { divisor: 1_000, suffix: "k" },
];

function formatWithSuffix(value: number): string {
  const abs = Math.abs(value);
  for (const unit of NUMBER_SUFFIXES) {
    if (abs >= unit.divisor) {
      const scaled = value / unit.divisor;
      const precision = Math.abs(scaled) >= 100 ? 0 : Math.abs(scaled) >= 10 ? 1 : 2;
      const text = Number.isInteger(scaled) ? String(scaled) : scaled.toFixed(precision);
      const compact = text.replace(/\.0+$/, "").replace(/(\.\d*[1-9])0+$/, "$1");
      return `${compact}${unit.suffix}`;
    }
  }
  return String(value);
}

function formatDisplayNumber(value: number | null): string {
  if (value === null) {
    return "-";
  }
  return formatWithSuffix(value);
}

function normalizeSpaces(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function modeFromEntry(name: string, fluidName: string | null): EntryMode {
  if (fluidName !== null || /^drop of\b/i.test(name.trim())) {
    return "fluid";
  }
  return "item";
}

function stripDropOfPrefix(name: string): string {
  const normalized = normalizeSpaces(name);
  const match = /^drop of\s+(.+)$/i.exec(normalized);
  if (match) {
    return match[1];
  }
  return normalized;
}

function buildNameForMode(mode: EntryMode, rawName: string): string {
  const cleaned = normalizeSpaces(rawName);
  if (cleaned.length === 0) {
    return "";
  }
  if (mode === "fluid") {
    return `drop of ${cleaned}`;
  }
  return cleaned;
}

function toTitleCaseWords(value: string): string {
  return normalizeSpaces(value)
    .split(" ")
    .filter((word) => word.length > 0)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function normalizeItemNameForSuggestion(name: string): string {
  const normalized = normalizeSpaces(name);
  const dropMatch = /^drop of\s+(.+)$/i.exec(normalized);
  if (dropMatch) {
    return `drop of ${toTitleCaseWords(dropMatch[1])}`;
  }
  return toTitleCaseWords(normalized);
}

function normalizeFluidNameForSuggestion(fluidName: string): string {
  return fluidName.trim().toLowerCase().replace(/\s+/g, "");
}

function collectNamingSuggestions(name: string, fluidName: string | null): NamingSuggestion[] {
  const suggestions: NamingSuggestion[] = [];

  const suggestedItemName = normalizeItemNameForSuggestion(name);
  if (name !== suggestedItemName) {
    suggestions.push({
      field: "name",
      current: name,
      suggested: suggestedItemName,
    });
  }

  if (fluidName !== null) {
    const suggestedFluidName = normalizeFluidNameForSuggestion(fluidName);
    if (fluidName !== suggestedFluidName) {
      suggestions.push({
        field: "fluidName",
        current: fluidName,
        suggested: suggestedFluidName,
      });
    }
  }

  return suggestions;
}

async function loadItems(): Promise<void> {
  loading.value = true;
  error.value = "";

  try {
    const response = await fetch("/api/items");
    if (!response.ok) {
      throw new Error(`Failed to load items (${response.status}).`);
    }

    const data = (await response.json()) as { items: ItemEntry[] };
    items.value = data.items;
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "Failed to load items.";
  } finally {
    loading.value = false;
  }
}

async function loadSleep(): Promise<void> {
  try {
    const response = await fetch("/api/sleep");
    if (!response.ok) {
      throw new Error(`Failed to load sleep (${response.status}).`);
    }

    const data = (await response.json()) as { sleep: number };
    sleepInput.value = String(data.sleep);
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "Failed to load sleep value.";
  }
}

async function loadConfigPreview(): Promise<void> {
  try {
    const response = await fetch("/config");
    if (!response.ok) {
      throw new Error(`Failed to load config (${response.status}).`);
    }

    configPreview.value = await response.text();
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "Failed to load config file.";
  }
}

async function saveSleep(): Promise<void> {
  if (sleepInput.value.trim().length === 0) {
    error.value = "Sleep value is required.";
    return;
  }

  savingSleep.value = true;
  error.value = "";

  try {
    const sleep = sleepInput.value.trim();
    const response = await fetch("/api/sleep", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ sleep }),
    });

    const data = (await response.json()) as { sleep?: number; error?: string };
    if (!response.ok) {
      throw new Error(data.error ?? `Failed to save sleep (${response.status}).`);
    }

    sleepInput.value = String(data.sleep ?? sleep);
    await loadConfigPreview();
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "Failed to save sleep value.";
  } finally {
    savingSleep.value = false;
  }
}

function buildFormPayload(): ItemPayload {
  const name = buildNameForMode(formMode.value, form.name);
  const fluidName = formMode.value === "fluid" ? (form.fluidName.trim().length === 0 ? null : form.fluidName.trim()) : null;

  return {
    name,
    threshold: form.threshold.trim(),
    batchSize: form.batchSize.trim(),
    fluidName,
    priority: form.priority,
    group: form.group.trim().length === 0 ? null : form.group.trim(),
  };
}

function buildInlinePayload(): ItemPayload {
  const name = buildNameForMode(inlineMode.value, inlineDraft.name);
  const fluidName =
    inlineMode.value === "fluid" ? (inlineDraft.fluidName.trim().length === 0 ? null : inlineDraft.fluidName.trim()) : null;

  return {
    name,
    threshold: inlineDraft.threshold.trim(),
    batchSize: inlineDraft.batchSize.trim(),
    fluidName,
    priority: inlineDraft.priority,
    group: inlineDraft.group.trim().length === 0 ? null : inlineDraft.group.trim(),
  };
}

function applyPayloadToForm(payload: ItemPayload): void {
  const detectedMode = modeFromEntry(payload.name, payload.fluidName);
  formMode.value = detectedMode;
  form.name = detectedMode === "fluid" ? stripDropOfPrefix(payload.name) : payload.name;
  form.threshold = payload.threshold;
  form.batchSize = payload.batchSize;
  form.fluidName = detectedMode === "fluid" ? (payload.fluidName ?? "") : "";
  form.priority = payload.priority;
  form.group = payload.group ?? "";
}

function applyPayloadToInline(payload: ItemPayload): void {
  const detectedMode = modeFromEntry(payload.name, payload.fluidName);
  inlineMode.value = detectedMode;
  inlineDraft.name = detectedMode === "fluid" ? stripDropOfPrefix(payload.name) : payload.name;
  inlineDraft.threshold = payload.threshold;
  inlineDraft.batchSize = payload.batchSize;
  inlineDraft.fluidName = detectedMode === "fluid" ? (payload.fluidName ?? "") : "";
  inlineDraft.priority = payload.priority;
  inlineDraft.group = payload.group ?? "";
}

function validateItemPayload(payload: ItemPayload, mode: EntryMode): string | null {
  if (payload.name.length === 0) {
    return "Item name is required.";
  }

  if (payload.batchSize.length === 0) {
    return "Batch size is required.";
  }

  if (mode === "item" && /^drop of\b/i.test(payload.name)) {
    return "Item mode does not allow names starting with 'drop of'. Switch to fluid mode instead.";
  }

  if (mode === "fluid" && (payload.fluidName === null || payload.fluidName.length === 0)) {
    return "Fluid mode requires a fluid name.";
  }

  if (payload.priority !== "standard" && payload.priority !== "low") {
    return "Priority must be either 'standard' or 'low'.";
  }

  return null;
}

function maybeCreateNamingWarning(
  context: "add" | "inline",
  mode: EntryMode,
  payload: ItemPayload,
  originalName: string | null,
): boolean {
  const suggestions = collectNamingSuggestions(payload.name, payload.fluidName);
  if (suggestions.length === 0) {
    return false;
  }

  namingWarning.value = {
    context,
    originalName,
    mode,
    payload: { ...payload },
    suggestions,
  };
  return true;
}

async function submitAddPayload(payload: ItemPayload, mode: EntryMode, skipNamingWarning: boolean): Promise<void> {
  const validationError = validateItemPayload(payload, mode);
  if (validationError) {
    error.value = validationError;
    return;
  }

  if (!skipNamingWarning && maybeCreateNamingWarning("add", mode, payload, null)) {
    return;
  }

  submitting.value = true;
  error.value = "";

  try {
    const response = await fetch("/api/items", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const data = (await response.json()) as { items?: ItemEntry[]; error?: string };
    if (!response.ok) {
      throw new Error(data.error ?? `Failed to add item (${response.status}).`);
    }

    items.value = data.items ?? [];
    form.name = "";
    form.threshold = "";
    form.batchSize = "1";
    form.fluidName = "";
    form.priority = "standard";
    form.group = "";
    formMode.value = "item";
    namingWarning.value = null;

    await loadConfigPreview();
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "Failed to add item.";
  } finally {
    submitting.value = false;
  }
}

async function addItem(): Promise<void> {
  if (!canSubmit.value) {
    return;
  }

  const payload = buildFormPayload();
  await submitAddPayload(payload, formMode.value, false);
}

function startInlineEdit(item: ItemEntry): void {
  inlineMode.value = modeFromEntry(item.name, item.fluidName);
  editingOriginalName.value = item.name;
  inlineDraft.name = inlineMode.value === "fluid" ? stripDropOfPrefix(item.name) : item.name;
  inlineDraft.threshold = item.threshold === null ? "" : formatWithSuffix(item.threshold);
  inlineDraft.batchSize = item.batchSize === null ? "" : formatWithSuffix(item.batchSize);
  inlineDraft.fluidName = inlineMode.value === "fluid" ? (item.fluidName ?? "") : "";
  inlineDraft.priority = item.priority;
  inlineDraft.group = item.group ?? "";
}

function activateInlineEdit(item: ItemEntry): void {
  if (editingOriginalName.value === item.name) {
    return;
  }
  startInlineEdit(item);
}

function cancelInlineEdit(): void {
  editingOriginalName.value = null;
}

function onFormModeChange(): void {
  if (formMode.value === "item") {
    form.fluidName = "";
  }
}

function setFormMode(mode: EntryMode): void {
  formMode.value = mode;
  onFormModeChange();
}

function onInlineModeChange(): void {
  if (inlineMode.value === "item") {
    inlineDraft.fluidName = "";
  }
}

function groupOptionsForItem(item: ItemEntry): string[] {
  const options = new Set(availableGroups.value);
  const current =
    editingOriginalName.value === item.name
      ? inlineDraft.group.trim()
      : item.group === null
        ? ""
        : item.group.trim();

  if (current.length > 0) {
    options.add(current);
  }

  return [...options].sort((a, b) => a.localeCompare(b));
}

async function moveItemToGroup(item: ItemEntry, rawGroup: string): Promise<void> {
  const nextGroup = rawGroup.trim().length === 0 ? null : rawGroup.trim();
  const currentGroup = item.group === null ? null : item.group.trim();
  if (nextGroup === currentGroup) {
    return;
  }

  movingGroupItemName.value = item.name;
  error.value = "";

  try {
    const response = await fetch("/api/items", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: item.name,
        threshold: item.threshold,
        batchSize: item.batchSize,
        fluidName: item.fluidName,
        priority: item.priority,
        group: nextGroup,
      }),
    });

    const data = (await response.json()) as { items?: ItemEntry[]; error?: string };
    if (!response.ok) {
      throw new Error(data.error ?? `Failed to move item group (${response.status}).`);
    }

    items.value = data.items ?? [];
    if (editingOriginalName.value === item.name) {
      inlineDraft.group = nextGroup ?? "";
    }
    await loadConfigPreview();
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "Failed to move item group.";
  } finally {
    movingGroupItemName.value = null;
  }
}

function onGroupChange(item: ItemEntry, event: Event): void {
  const target = event.target;
  if (!(target instanceof HTMLSelectElement)) {
    return;
  }
  void moveItemToGroup(item, target.value);
}

function isFluidItem(item: ItemEntry): boolean {
  return item.fluidName !== null || /^drop of\b/i.test(item.name);
}

async function submitInlinePayload(
  payload: ItemPayload,
  originalName: string,
  mode: EntryMode,
  skipNamingWarning: boolean,
): Promise<void> {
  const validationError = validateItemPayload(payload, mode);
  if (validationError) {
    error.value = validationError;
    return;
  }

  if (!skipNamingWarning && maybeCreateNamingWarning("inline", mode, payload, originalName)) {
    return;
  }

  savingInline.value = true;
  error.value = "";

  try {
    const upsertResponse = await fetch("/api/items", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const upsertData = (await upsertResponse.json()) as { error?: string };
    if (!upsertResponse.ok) {
      throw new Error(upsertData.error ?? `Failed to update item (${upsertResponse.status}).`);
    }

    if (payload.name !== originalName) {
      const deleteResponse = await fetch(`/api/items/${encodeURIComponent(originalName)}`, {
        method: "DELETE",
      });
      const deleteData = (await deleteResponse.json()) as { error?: string };
      if (!deleteResponse.ok) {
        throw new Error(deleteData.error ?? `Failed to rename item (${deleteResponse.status}).`);
      }
    }

    editingOriginalName.value = null;
    namingWarning.value = null;
    await loadItems();
    await loadConfigPreview();
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "Failed to update item.";
  } finally {
    savingInline.value = false;
  }
}

async function saveInlineEdit(): Promise<void> {
  if (!editingOriginalName.value) {
    return;
  }

  const originalName = editingOriginalName.value;
  const payload = buildInlinePayload();
  await submitInlinePayload(payload, originalName, inlineMode.value, false);
}

async function acceptNamingSuggestion(): Promise<void> {
  if (!namingWarning.value) {
    return;
  }

  const warning = namingWarning.value;
  const nextPayload: ItemPayload = {
    ...warning.payload,
  };

  for (const suggestion of warning.suggestions) {
    if (suggestion.field === "name") {
      nextPayload.name = suggestion.suggested;
    } else if (suggestion.field === "fluidName") {
      nextPayload.fluidName = suggestion.suggested;
    }
  }

  if (warning.context === "add") {
    applyPayloadToForm(nextPayload);
    namingWarning.value = null;
    await submitAddPayload(nextPayload, warning.mode, true);
    return;
  }

  if (!warning.originalName) {
    namingWarning.value = null;
    return;
  }

  applyPayloadToInline(nextPayload);
  namingWarning.value = null;
  await submitInlinePayload(nextPayload, warning.originalName, warning.mode, true);
}

async function rejectNamingSuggestion(): Promise<void> {
  if (!namingWarning.value) {
    return;
  }

  const warning = namingWarning.value;
  namingWarning.value = null;

  if (warning.context === "add") {
    await submitAddPayload(warning.payload, warning.mode, true);
    return;
  }

  if (!warning.originalName) {
    return;
  }

  await submitInlinePayload(warning.payload, warning.originalName, warning.mode, true);
}

async function removeItem(name: string): Promise<void> {
  error.value = "";

  try {
    const response = await fetch(`/api/items/${encodeURIComponent(name)}`, {
      method: "DELETE",
    });

    const data = (await response.json()) as { items?: ItemEntry[]; error?: string };
    if (!response.ok) {
      throw new Error(data.error ?? `Failed to remove item (${response.status}).`);
    }

    items.value = data.items ?? [];
    await loadConfigPreview();
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "Failed to remove item.";
  }
}

onMounted(async () => {
  await loadItems();
  await loadSleep();
  await loadConfigPreview();
});
</script>

<template>
  <main class="page">
    <section class="panel">
      <h1>Level Maintainer Config Editor</h1>

      <form class="sleep-form" @submit.prevent="saveSleep">
        <label>
          Sleep Time (seconds)
          <input v-model="sleepInput" type="text" inputmode="decimal" required placeholder="10 / 1k" />
        </label>
        <button :disabled="savingSleep" type="submit">
          {{ savingSleep ? "Saving..." : "Save Sleep" }}
        </button>
      </form>
      <p class="hint">
        Pick mode: <code>item</code> keeps normal names, <code>fluid</code> forces <code>drop of</code> names and
        requires fluid name. Numeric fields support suffixes <code>k</code>, <code>m</code>, <code>g</code>,
        <code>t</code>.
      </p>
      <p class="hint">
        Example fluid: mode <code>fluid</code>, name <code>Molten SpaceTime</code> (stored as
        <code>drop of Molten SpaceTime</code>), threshold <code>1m</code>, batch <code>1k</code>, fluid
        <code>spacetime</code>.
      </p>

      <div v-if="namingWarning" class="warning-box">
        <p class="warning-title">Name formatting suggestion</p>
        <p v-for="suggestion in namingWarning.suggestions" :key="`${namingWarning.context}-${suggestion.field}`" class="warning-line">
          {{ suggestion.field === "name" ? "Item name" : "Fluid name" }}:
          <code>{{ suggestion.current }}</code> -> <code>{{ suggestion.suggested }}</code>
        </p>
        <div class="warning-actions">
          <button class="secondary" type="button" @click="acceptNamingSuggestion">Use suggestion</button>
          <button class="secondary" type="button" @click="rejectNamingSuggestion">Keep original</button>
        </div>
      </div>

      <section class="mode-section">
        <p class="mode-title">Mode</p>
        <div class="mode-toggle" role="group" aria-label="Entry mode selector">
          <button
            class="mode-icon-button item-mode"
            :class="{ active: formMode === 'item' }"
            type="button"
            title="Item mode"
            aria-label="Item mode"
            @click="setFormMode('item')"
          >
            <img :src="stoneDustIcon" class="mode-icon-image" alt="" aria-hidden="true" />
          </button>
          <button
            class="mode-icon-button fluid-mode"
            :class="{ active: formMode === 'fluid' }"
            type="button"
            title="Fluid mode"
            aria-label="Fluid mode"
            @click="setFormMode('fluid')"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path
                d="M12 3.5C12 3.5 6 10.1 6 14.2C6 17.6 8.7 20.3 12 20.3C15.3 20.3 18 17.6 18 14.2C18 10.1 12 3.5 12 3.5Z"
                fill="currentColor"
              />
            </svg>
          </button>
        </div>
        <form class="item-form" @submit.prevent="addItem">
          <label>
            Name
            <div v-if="formMode === 'fluid'" class="prefixed-input">
              <span class="name-prefix">drop of</span>
              <input v-model="form.name" required placeholder="Molten SpaceTime" />
            </div>
            <input v-else v-model="form.name" required placeholder="Any UEV Circuit" />
          </label>

          <label>
            Threshold (optional)
            <input v-model="form.threshold" type="text" inputmode="decimal" placeholder="1m" />
          </label>

          <label>
            Batch Size
            <input v-model="form.batchSize" type="text" inputmode="decimal" required placeholder="1 / 1k" />
          </label>

          <label v-if="formMode === 'fluid'">
            Fluid Name
            <input v-model="form.fluidName" required placeholder="spacetime" />
          </label>

          <label>
            <span class="inline-with-tooltip">
              Priority
              <span
                class="info-tooltip"
                title="standard: normal crafting behavior. low: only crafts when fewer than 10 crafts are active and no non-maintainer crafts are running."
              >
                ?
              </span>
            </span>
            <select v-model="form.priority">
              <option value="standard">standard</option>
              <option value="low">low</option>
            </select>
          </label>

          <label>
            Group (optional)
            <input v-model="form.group" placeholder="AE2 Drops" />
          </label>

          <button :disabled="!canSubmit || submitting" type="submit">
            {{ submitting ? "Saving..." : "Add / Update Item" }}
          </button>
        </form>
      </section>

      <p v-if="error" class="error">{{ error }}</p>
    </section>

    <section class="panel">
      <div class="panel-head">
        <h2>Configured Items</h2>
        <button class="secondary" :disabled="loading" @click="loadItems">Refresh</button>
      </div>

      <div v-if="items.length > 0" class="group-list">
        <section v-for="section in groupedItems" :key="section.key" class="group-section">
          <h3 class="group-title">{{ section.label }}</h3>
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Threshold</th>
                <th>Batch</th>
                <th>Fluid</th>
                <th>
                  <span class="inline-with-tooltip">
                    Priority
                    <span
                      class="info-tooltip"
                      title="standard: normal crafting behavior. low: only crafts when fewer than 10 crafts are active and no non-maintainer crafts are running."
                    >
                      ?
                    </span>
                  </span>
                </th>
                <th>Group</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="item in section.items" :key="item.name" :class="isFluidItem(item) ? 'row-fluid' : 'row-item'">
                <td class="editable-cell" @click="activateInlineEdit(item)">
                  <div v-if="editingOriginalName === item.name" class="inline-name-editor" @click.stop>
                    <select v-model="inlineMode" class="mode-select" @change="onInlineModeChange">
                      <option value="item">item</option>
                      <option value="fluid">fluid</option>
                    </select>
                    <div v-if="inlineMode === 'fluid'" class="prefixed-input">
                      <span class="name-prefix">drop of</span>
                      <input
                        v-model="inlineDraft.name"
                        type="text"
                        placeholder="Molten SpaceTime"
                        @keydown.enter.prevent="saveInlineEdit"
                        @keydown.esc.prevent="cancelInlineEdit"
                      />
                    </div>
                    <input
                      v-else
                      v-model="inlineDraft.name"
                      type="text"
                      placeholder="Any UEV Circuit"
                      @keydown.enter.prevent="saveInlineEdit"
                      @keydown.esc.prevent="cancelInlineEdit"
                    />
                  </div>
                  <span v-else>{{ item.name }}</span>
                </td>
                <td class="editable-cell" @click="activateInlineEdit(item)">
                  <input
                    v-if="editingOriginalName === item.name"
                    v-model="inlineDraft.threshold"
                    type="text"
                    inputmode="decimal"
                    placeholder="- / 1k"
                    @click.stop
                    @keydown.enter.prevent="saveInlineEdit"
                    @keydown.esc.prevent="cancelInlineEdit"
                  />
                  <span v-else>{{ formatDisplayNumber(item.threshold) }}</span>
                </td>
                <td class="editable-cell" @click="activateInlineEdit(item)">
                  <input
                    v-if="editingOriginalName === item.name"
                    v-model="inlineDraft.batchSize"
                    type="text"
                    inputmode="decimal"
                    placeholder="1 / 1k"
                    @click.stop
                    @keydown.enter.prevent="saveInlineEdit"
                    @keydown.esc.prevent="cancelInlineEdit"
                  />
                  <span v-else>{{ formatDisplayNumber(item.batchSize) }}</span>
                </td>
                <td class="editable-cell" @click="activateInlineEdit(item)">
                  <input
                    v-if="editingOriginalName === item.name && inlineMode === 'fluid'"
                    v-model="inlineDraft.fluidName"
                    type="text"
                    required
                    placeholder="spacetime"
                    @click.stop
                    @keydown.enter.prevent="saveInlineEdit"
                    @keydown.esc.prevent="cancelInlineEdit"
                  />
                  <span v-else-if="editingOriginalName === item.name">-</span>
                  <span v-else>{{ item.fluidName ?? "-" }}</span>
                </td>
                <td class="editable-cell" @click="activateInlineEdit(item)">
                  <select
                    v-if="editingOriginalName === item.name"
                    v-model="inlineDraft.priority"
                    @click.stop
                    @keydown.enter.prevent="saveInlineEdit"
                    @keydown.esc.prevent="cancelInlineEdit"
                  >
                    <option value="standard">standard</option>
                    <option value="low">low</option>
                  </select>
                  <span v-else>{{ item.priority }}</span>
                </td>
                <td>
                  <select
                    class="group-select"
                    :value="item.group ?? ''"
                    :disabled="movingGroupItemName === item.name"
                    @change="onGroupChange(item, $event)"
                  >
                    <option value="">Ungrouped</option>
                    <option v-for="groupName in groupOptionsForItem(item)" :key="groupName" :value="groupName">
                      {{ groupName }}
                    </option>
                  </select>
                </td>
                <td>
                  <div v-if="editingOriginalName === item.name" class="inline-actions">
                    <button class="secondary" type="button" :disabled="savingInline" @click="saveInlineEdit">Save</button>
                    <button class="secondary" type="button" :disabled="savingInline" @click="cancelInlineEdit">Cancel</button>
                  </div>
                  <button v-else class="danger" type="button" @click="removeItem(item.name)">Remove</button>
                </td>
              </tr>
            </tbody>
          </table>
        </section>
      </div>
      <p v-else class="muted">No items configured.</p>
    </section>

    <section class="panel">
      <div class="panel-head">
        <h2>/config Preview</h2>
        <button class="secondary" @click="loadConfigPreview">Reload</button>
      </div>
      <pre>{{ configPreview }}</pre>
    </section>
  </main>
</template>
