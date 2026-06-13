const STORAGE_KEY = "trading-technique-selected-model-v1";

let memoryModelId: string | null = null;

export function peekSelectedTechModelId(): string | null {
  if (memoryModelId) return memoryModelId;
  if (typeof sessionStorage === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    return raw?.trim() ? raw.trim() : null;
  } catch {
    return null;
  }
}

export function saveSelectedTechModelId(id: string): void {
  const trimmed = id.trim();
  if (!trimmed) return;
  memoryModelId = trimmed;
  try {
    sessionStorage.setItem(STORAGE_KEY, trimmed);
  } catch {
    /* ignore */
  }
}

export function clearSelectedTechModelId(): void {
  memoryModelId = null;
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
