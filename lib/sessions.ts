// Session history in localStorage. Saved from event handlers (not effects):
// the record is written when a session finishes, and updated in place once
// the comprehension quiz is checked.

export type SessionRecord = {
  id: string;
  t: number;
  passage: string;
  wpm: number;
  comprehension: number | null; // 0..1
  regressions: number;
};

const STORAGE_KEY = "gazelle-sessions";

export function loadHistory(): SessionRecord[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
  } catch {
    return [];
  }
}

export function saveSession(rec: Omit<SessionRecord, "id">): string {
  const id = `${rec.t}-${Math.random().toString(36).slice(2, 8)}`;
  const all = [...loadHistory(), { ...rec, id }].slice(-50);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  return id;
}

export function setComprehension(id: string, score: number): SessionRecord[] {
  const all = loadHistory().map((r) => (r.id === id ? { ...r, comprehension: score } : r));
  localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  return all;
}
