import { readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Encoding regression test — keeps broken Vietnamese out of the app.
 *
 * WHY THIS EXISTS
 *
 * The address book rendered "Máº·c Ä‘á»‹nh" instead of "Mặc định". The cause was
 * not the font and not the renderer: `apps/mobile/app/addresses.tsx` had been
 * saved as UTF-8 *after* its text had been decoded as Windows-1252, so the file
 * literally contained the wrong characters. Every Vietnamese label in that file
 * was affected, and nothing in the build caught it because the file is valid
 * UTF-8 — just the wrong text.
 *
 * WHAT IT CHECKS
 *
 * 1. No source file contains a C1 control character (U+0080–U+009F). Those never
 *    appear in legitimate source text; in this bug they are the leftover bytes
 *    of a double-encoded sequence.
 * 2. No line contains a mojibake byte signature (`Ã¡`, `á»`, `â€`, `Ä‘`, …) that
 *    reverses losslessly into Vietnamese text the original line does not have.
 *    The reversal is what makes this precise: it only flags text that is
 *    provably a corrupted form of real Vietnamese, so legitimate uses of `…`,
 *    `–`, `·` and accented Latin characters are not false-positived.
 *
 * A NEW file with the same defect fails this test immediately, which is the
 * point: the fix was one file, but the guard is the whole app.
 */

const APP_ROOT = resolve(__dirname, "../../..");

/** Directories that are generated, vendored or binary. */
const SKIP_DIRS = new Set([
  "node_modules",
  ".expo",
  "dist",
  ".next",
  "build",
  "coverage",
  "generated",
  "assets",
]);

const SKIP_EXT = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".pdf",
  ".woff", ".woff2", ".ttf", ".otf", ".mp4", ".mp3", ".zip",
]);

const CP1252_REVERSE: Record<number, number> = {
  0x20ac: 0x80, 0x201a: 0x82, 0x0192: 0x83, 0x201e: 0x84, 0x2026: 0x85,
  0x2020: 0x86, 0x2021: 0x87, 0x02c6: 0x88, 0x2030: 0x89, 0x0160: 0x8a,
  0x2039: 0x8b, 0x0152: 0x8c, 0x017d: 0x8e, 0x2018: 0x91, 0x2019: 0x92,
  0x201c: 0x93, 0x201d: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97,
  0x02dc: 0x98, 0x2122: 0x99, 0x0161: 0x9a, 0x203a: 0x9b, 0x0153: 0x9c,
  0x017e: 0x9e, 0x0178: 0x9f,
};

function toBytes(text: string): Buffer | null {
  const out: number[] = [];
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    if (CP1252_REVERSE[cp] !== undefined) out.push(CP1252_REVERSE[cp]);
    else if (cp <= 0xff) out.push(cp);
    else return null;
  }
  return Buffer.from(out);
}

/** Reverse a UTF-8 → CP1252 → UTF-8 double encoding, or `null` if impossible. */
function recover(text: string): string | null {
  const bytes = toBytes(text);
  if (!bytes) return null;
  const decoded = bytes.toString("utf8");
  return decoded.includes("\uFFFD") ? null : decoded;
}

const C1_CONTROL = /[\u0080-\u009F]/;

/**
 * Sequences that cannot occur in correctly encoded Vietnamese. `Ã`/`Ä`/`Æ`/`Â`
 * followed by a C1 or CP1252-mapped character, `á` followed by `»`/`º`, and
 * `â` followed by a CP1252 quote/dash.
 */
const MOJIBAKE_SIGNATURE =
  /[\u00C3\u00C4\u00C6\u00C2][\u0080-\u00BF\u2013\u2014\u2018\u2019\u201A\u201C\u201D\u201E\u2020\u2021\u2022\u2026\u2030\u2039\u203A\u20AC\u2122\u02C6\u02DC\u0160\u0161\u0152\u0153\u017D\u017E\u0192]|[\u00E1\u00E0][\u00BB\u00BA]|[\u00E2][\u20AC\u201A\u201E\u2026\u201C\u201D]|[\u00C6][\u00B0\u00A1]/;

const VIETNAMESE = /[ăâđêôơưàáảãạằắẳẵặầấẩẫậèéẻẽẹềếểễệìíỉĩịòóỏõọồốổỗộờớởỡợùúủũụừứửữựỳýỷỹỵ]/i;

function collectSourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) {
      collectSourceFiles(abs, acc);
      continue;
    }
    if (SKIP_EXT.has(extname(entry.name).toLowerCase())) continue;
    if (statSync(abs).size > 2 * 1024 * 1024) continue;
    acc.push(abs);
  }
  return acc;
}

/**
 * This test file is excluded from the scan.
 *
 * It has to *contain* mojibake to prove the detector works, so scanning it
 * would always fail. The exclusion is by resolved path (never a bare name), and
 * the positive-control test below still asserts the detector fires on those
 * same fixtures.
 */
const SELF = resolve(__filename).replace(/\\/g, "/");

interface Problem {
  file: string;
  line: number;
  reason: string;
  before: string;
  after: string | null;
}

function scanFile(abs: string): Problem[] {
  if (resolve(abs).replace(/\\/g, "/") === SELF) return [];
  const buf = readFileSync(abs);
  if (buf.includes(0)) return []; // binary
  const text = buf.toString("utf8");
  const rel = relative(APP_ROOT, abs).replace(/\\/g, "/");
  const problems: Problem[] = [];

  text.split("\n").forEach((line, index) => {
    if (!line) return;
    const isC1 = C1_CONTROL.test(line);
    const hasSignature = MOJIBAKE_SIGNATURE.test(line);
    if (!isC1 && !hasSignature) return;
    const recovered = recover(line);
    if (!recovered || recovered === line) return;
    // For a signature-only hit, require proof the recovery produced Vietnamese.
    if (!isC1 && !VIETNAMESE.test(recovered)) return;
    problems.push({
      file: rel,
      line: index + 1,
      reason: isC1 ? "C1 control character" : "mojibake signature",
      before: line.trim().slice(0, 120),
      after: recovered.trim().slice(0, 120),
    });
  });

  return problems;
}

describe("source encoding (UTF-8 integrity)", () => {
  const files = collectSourceFiles(APP_ROOT);

  it("scans a meaningful number of source files", () => {
    // Guards against the walker silently matching nothing.
    expect(files.length).toBeGreaterThan(30);
    expect(files.some((f) => f.endsWith("addresses.tsx"))).toBe(true);
  });

  it("contains no mojibake or C1 control characters", () => {
    const problems = files.flatMap(scanFile);
    const report = problems
      .map((p) => `${p.file}:${p.line} [${p.reason}]\n  found:   ${p.before}\n  correct: ${p.after}`)
      .join("\n");
    expect(problems, `Broken Vietnamese text found:\n${report}`).toEqual([]);
  });

  it("detects a double-encoded line (the detector actually works)", () => {
    // Positive controls built from CHARACTER CODES, so this file itself stays
    // valid UTF-8 while still proving the detector fires on the exact defect
    // that shipped — a detector that never fires is worse than none.
    const cp = (s: string): string => String.fromCodePoint(...s.split(" ").map((h) => parseInt(h, 16)));

    // "Máº·c Ä‘á»‹nh" -> "Mặc định"
    const broken = cp("4d e1 ba b7 63 20 c4 2018 e1 bb 2039 6e 68");
    expect(MOJIBAKE_SIGNATURE.test(broken)).toBe(true);
    expect(recover(broken)).toBe("Mặc định");

    // "XÃ³a Ä‘á»‹a chá»‰" -> "Xóa địa chỉ"
    const brokenAlert = cp("58 c3 b3 61 20 c4 2018 e1 bb 2039 61 20 63 68 e1 bb 2030");
    expect(MOJIBAKE_SIGNATURE.test(brokenAlert)).toBe(true);
    expect(recover(brokenAlert)).toBe("Xóa địa chỉ");

    // "ThÃªm" -> "Thêm"
    expect(recover(cp("54 68 c3 aa 6d"))).toBe("Thêm");
  });

  it("does not flag legitimate Vietnamese or typography", () => {
    // The real strings from the fixed screen, plus punctuation the detector
    // must leave alone.
    for (const ok of [
      "Mặc định",
      "Thêm địa chỉ",
      "Sổ địa chỉ — danh sách",
      "Đang tải…",
      "Đơn tối thiểu 300.000 ₫",
      "a.recipientName} · {a.phone",
      "Chưa theo danh mục xã/phường 2025",
      "Sản phẩm nổi bật",
    ]) {
      expect(C1_CONTROL.test(ok), `C1 false positive: ${ok}`).toBe(false);
      const recovered = recover(ok);
      // Either unrecoverable, or a no-op — never a "different" string.
      expect(recovered === null || recovered === ok, `false positive: ${ok}`).toBe(true);
    }
  });

  it("reads the address book with correct Vietnamese labels", () => {
    // The exact strings the user saw broken. Read from disk, so a future
    // re-encode of this file fails here as well as in the scan above.
    const source = readFileSync(join(APP_ROOT, "app", "addresses.tsx"), "utf8");
    for (const label of ["Mặc định", "Sửa", "Xóa", "Thêm địa chỉ", "Địa chỉ cũ", "Sổ địa chỉ"]) {
      expect(source, `missing correct label: ${label}`).toContain(label);
    }
    // The broken forms are assembled from character codes so this file stays
    // clean UTF-8 while still asserting their absence.
    const cp = (s: string): string => String.fromCodePoint(...s.split(" ").map((h) => parseInt(h, 16)));
    for (const broken of [
      cp("4d e1 ba b7 63"), // "Máº·c"
      cp("58 c3 b3 61"), // "XÃ³a"
      cp("54 68 c3 aa 6d"), // "ThÃªm"
      cp("53 e1 bb ad 61"), // "Sá»­a"
      cp("c4 2018 e1 bb 2039 61"), // "Ä‘á»‹a"
    ]) {
      expect(source, `still contains mojibake: ${broken}`).not.toContain(broken);
    }
    // No C1 control characters anywhere in the file.
    expect(C1_CONTROL.test(source)).toBe(false);
  });
});
