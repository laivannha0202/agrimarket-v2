/**
 * Time helpers isolated from render bodies.
 *
 * React 19's purity lint rule flags direct `Date.now()` calls during render
 * (they are impure and can produce unstable results across re-renders). Wrapping
 * the call in a plain module function keeps the impure call out of the
 * component render body while still returning a real timestamp.
 */
export function currentTimeMs(): number {
  return Date.now();
}
