/**
 * Vietnamese text helpers shared by the commune catalogue, its search and the
 * seed script.
 *
 * The catalogue is stored with its official accented names ("Phường Phố Hiến")
 * and customers are not expected to type accents — nobody searches for "Phố
 * Hiến" with a Vietnamese keyboard when "pho hien" is faster. Both sides
 * therefore go through the SAME folding function here, so a stored
 * `searchText` and an incoming query can never drift apart.
 */

/**
 * Folds a Vietnamese string to a comparable ASCII-ish key:
 * lower-cases it and strips every diacritic, so "Phường Phố Hiến" becomes
 * "phuong pho hien".
 *
 * `đ`/`Đ` are handled explicitly because they are distinct letters, not a
 * base letter plus a combining mark — Unicode decomposition leaves them
 * untouched.
 */
export function foldVietnamese(input: string): string {
  return input
    .normalize('NFD')
    // Combining diacritical marks: the accents themselves.
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Collapses whitespace and trims. Used before storing free-text address parts
 * so a value pasted from elsewhere cannot leave stray spacing that later shows
 * up as a doubled comma in the UI.
 */
export function normalizeWhitespace(input: string): string {
  return input.replace(/\s+/g, ' ').trim();
}

/**
 * Joins the non-empty parts of an address with ", ".
 *
 * Blank, whitespace-only and nullish parts are dropped BEFORE joining, so the
 * result never contains ", ," or a trailing comma — the display bug that
 * appears when an optional level (village, for instance) is empty.
 */
export function joinAddressParts(parts: Array<string | null | undefined>): string {
  return parts
    .map((part) => (part == null ? '' : normalizeWhitespace(part)))
    .filter((part) => part.length > 0)
    .join(', ');
}
