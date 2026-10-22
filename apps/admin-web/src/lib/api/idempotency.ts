/**
 * Keeps one `Idempotency-Key` per unchanged form payload while a submit is
 * being retried (timeout, lost response, double click). A different payload —
 * or a successful submit that clears the store — gets a fresh key, because two
 * genuinely different operations must never share an identity.
 */
export interface IdempotencyStore {
  current: { fingerprint: string; key: string } | null;
}

export function idempotencyKeyFor(store: IdempotencyStore, payload: unknown): string {
  const fingerprint = JSON.stringify(payload);
  if (store.current?.fingerprint === fingerprint) return store.current.key;

  const key =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `idem-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  store.current = { fingerprint, key };
  return key;
}
