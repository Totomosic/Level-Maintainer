<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";

interface ItemEntry {
  name: string;
  threshold: number | null;
  batchSize: number | null;
  fluidName: string | null;
  group: string | null;
}

interface ItemEditDraft {
  name: string;
  threshold: string;
  batchSize: string;
  fluidName: string;
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

const form = reactive({
  name: "",
  threshold: "",
  batchSize: "1",
  fluidName: "",
  group: "",
});

const inlineDraft = reactive<ItemEditDraft>({
  name: "",
  threshold: "",
  batchSize: "",
  fluidName: "",
  group: "",
});

const canSubmit = computed(() => form.name.trim().length > 0 && form.batchSize.trim().length > 0);
const addFormRequiresFluid = computed(() => /^drop of\b/i.test(form.name.trim()));
const inlineRequiresFluid = computed(() => /^drop of\b/i.test(inlineDraft.name.trim()));
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

async function addItem(): Promise<void> {
  if (!canSubmit.value) {
    return;
  }

  if (addFormRequiresFluid.value && form.fluidName.trim().length === 0) {
    error.value = "Fluid name is required when item name begins with 'drop of'.";
    return;
  }

  submitting.value = true;
  error.value = "";

  try {
    const payload = {
      name: form.name.trim(),
      threshold: form.threshold.trim(),
      batchSize: form.batchSize.trim(),
      fluidName: form.fluidName.trim().length === 0 ? null : form.fluidName.trim(),
      group: form.group.trim().length === 0 ? null : form.group.trim(),
    };

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
    form.group = "";

    await loadConfigPreview();
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "Failed to add item.";
  } finally {
    submitting.value = false;
  }
}

function startInlineEdit(item: ItemEntry): void {
  editingOriginalName.value = item.name;
  inlineDraft.name = item.name;
  inlineDraft.threshold = item.threshold === null ? "" : formatWithSuffix(item.threshold);
  inlineDraft.batchSize = item.batchSize === null ? "" : formatWithSuffix(item.batchSize);
  inlineDraft.fluidName = item.fluidName ?? "";
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

async function saveInlineEdit(): Promise<void> {
  if (!editingOriginalName.value) {
    return;
  }

  const originalName = editingOriginalName.value;
  const payload = {
    name: inlineDraft.name.trim(),
    threshold: inlineDraft.threshold.trim(),
    batchSize: inlineDraft.batchSize.trim(),
    fluidName: inlineDraft.fluidName.trim().length === 0 ? null : inlineDraft.fluidName.trim(),
    group: inlineDraft.group.trim().length === 0 ? null : inlineDraft.group.trim(),
  };

  if (payload.name.length === 0) {
    error.value = "Item name is required.";
    return;
  }

  if (/^drop of\b/i.test(payload.name) && (payload.fluidName === null || payload.fluidName.length === 0)) {
    error.value = "Fluid name is required when item name begins with 'drop of'.";
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
    await loadItems();
    await loadConfigPreview();
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "Failed to update item.";
  } finally {
    savingInline.value = false;
  }
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
      <p class="muted">Manage <code>cfg["sleep"]</code> and entries in <code>cfg["items"]</code> inside <code>config.lua</code>.</p>

      <form class="sleep-form" @submit.prevent="saveSleep">
        <label>
          Sleep Time (seconds)
          <input v-model="sleepInput" type="text" inputmode="decimal" required placeholder="10 / 1k" />
        </label>
        <button :disabled="savingSleep" type="submit">
          {{ savingSleep ? "Saving..." : "Save Sleep" }}
        </button>
      </form>
      <p class="hint">Numeric suffixes supported: <code>k</code>, <code>m</code>, <code>g</code>, <code>t</code>.</p>
      <p class="hint">Click any field in an existing row to edit it inline.</p>
      <p class="hint">If item name starts with <code>drop of</code>, fluid name is required.</p>
      <p class="hint">Optional group labels are written as <code>-- @group: ...</code> comments in <code>config.lua</code>.</p>
      <p class="hint">Use the group dropdown on each row to move items between groups.</p>

      <form class="item-form" @submit.prevent="addItem">
        <label>
          Item Name
          <input v-model="form.name" required placeholder="drop of Molten SpaceTime" />
        </label>

        <label>
          Threshold (optional)
          <input v-model="form.threshold" type="text" inputmode="decimal" placeholder="1m" />
        </label>

        <label>
          Batch Size
          <input v-model="form.batchSize" type="text" inputmode="decimal" required placeholder="1 / 1k" />
        </label>

        <label>
          Fluid Name
          <input
            v-model="form.fluidName"
            :required="addFormRequiresFluid"
            :placeholder="addFormRequiresFluid ? 'required for drop of*' : 'spacetime'"
          />
        </label>

        <label>
          Group (optional)
          <input v-model="form.group" placeholder="AE2 Drops" />
        </label>

        <button :disabled="!canSubmit || submitting" type="submit">
          {{ submitting ? "Saving..." : "Add / Update Item" }}
        </button>
      </form>

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
                <th>Group</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="item in section.items" :key="item.name">
                <td class="editable-cell" @click="activateInlineEdit(item)">
                  <input
                    v-if="editingOriginalName === item.name"
                    v-model="inlineDraft.name"
                    type="text"
                    @click.stop
                    @keydown.enter.prevent="saveInlineEdit"
                    @keydown.esc.prevent="cancelInlineEdit"
                  />
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
                    v-if="editingOriginalName === item.name"
                    v-model="inlineDraft.fluidName"
                    type="text"
                    :required="inlineRequiresFluid"
                    :placeholder="inlineRequiresFluid ? 'required for drop of*' : '-'"
                    @click.stop
                    @keydown.enter.prevent="saveInlineEdit"
                    @keydown.esc.prevent="cancelInlineEdit"
                  />
                  <span v-else>{{ item.fluidName ?? "-" }}</span>
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
