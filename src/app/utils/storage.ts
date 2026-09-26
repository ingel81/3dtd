/**
 * localStorage without the try/catch at every call. Storage can be blocked
 * (private mode, a browser setting) or full, and an entry can be corrupt:
 * a read then gives null, a write false, and the caller goes on with what it
 * has for this session.
 */

/** The stored text, null when missing or blocked. */
export function readText(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** Store `value`; false when storage is blocked or full. */
export function writeText(key: string, value: string): boolean {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

/** The stored JSON, parsed; null when missing, blocked or not JSON. The caller checks its shape. */
export function readJson(key: string): unknown {
  const raw = readText(key);
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

/** Store `value` as JSON; false when storage is blocked or full. */
export function writeJson(key: string, value: unknown): boolean {
  return writeText(key, JSON.stringify(value));
}

/** Drop `key`; nothing happens when storage is blocked. */
export function removeKey(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    /* blocked: nothing to drop */
  }
}
