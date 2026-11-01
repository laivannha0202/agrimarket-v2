import { inflateSync } from 'node:zlib';

/**
 * Minimal PDF text extractor for the export acceptance suite.
 *
 * PDFKit renders text as hex strings (`<001B001C> Tj` / `[<…>] TJ`) using one
 * subset font per weight, each with its OWN ToUnicode CMap — so a single
 * global glyph map decodes garbage. This helper maps every font resource name
 * (`/F1`, `/F2`, …) to its CMap, walks the page content tracking the active
 * font (`Tf`), and decodes each run with the right map.
 *
 * It is deliberately small: page content streams + three CMap range forms is
 * everything PDFKit emits (with multi-unit destination tokens for ligature or
 * astral glyphs). Anything fancier belongs in a real PDF library.
 */

function inflateIfNeeded(raw: Buffer): Buffer {
  try {
    return inflateSync(raw);
  } catch {
    return raw;
  }
}

/**
 * One ToUnicode destination token: one or more 4-digit hex UTF-16 units in a
 * single `<…>`. PDFKit emits one token per subset glyph id, and a ligature
 * glyph or astral character is a MULTI-unit token — e.g. the DejaVu `liga`
 * "fl" ligature is `<0066 006c>` for exactly ONE glyph. Treating that token as
 * two glyph entries silently shifts every later bfrange entry by one and
 * mis-decodes all subsequent text (e.g. `…-ORDEXP1` -> `…-REDXP·`), so
 * destination tokens must be grouped, never split per unit.
 */
const DEST_TOKEN = /<([0-9a-fA-F]{4}(?:\s+[0-9a-fA-F]{4})*)>/g;

/** UTF-16 units in one destination token -> string (BMP chars + astral pairs). */
function toUnicode(dst: string): string {
  return dst
    .split(/\s+/)
    .reduce((s, u) => s + String.fromCharCode(parseInt(u, 16)), '');
}

function parseCMap(cmap: string): Map<number, string> {
  const map = new Map<number, string>();
  for (const bf of cmap.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const line of bf[1].matchAll(/<([0-9a-fA-F]{4})>\s+<([0-9a-fA-F]{4}(?:\s+[0-9a-fA-F]{4})*)>/g)) {
      map.set(parseInt(line[1], 16), toUnicode(line[2]));
    }
  }
  for (const bf of cmap.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    let body = bf[1];
    // Array form first, then strip it so the pair/triple patterns cannot
    // match *inside* destination arrays. Every `[…]` slide must hold exactly
    // one destination token per glyph id in the ascending range.
    for (const line of body.matchAll(
      /<([0-9a-fA-F]+)>\s+<([0-9a-fA-F]+)>\s+\[([0-9a-fA-F<>\s]+)\]/g,
    )) {
      const lo = parseInt(line[1], 16);
      let gid = lo;
      for (const tok of line[3].matchAll(DEST_TOKEN)) {
        map.set(gid, toUnicode(tok[1]));
        gid += 1;
      }
    }
    body = body.replace(/<([0-9a-fA-F]+)>\s+<([0-9a-fA-F]+)>\s+\[[0-9a-fA-F<>\s]+\]/g, '');
    for (const line of body.matchAll(/<([0-9a-fA-F]+)>\s+<([0-9a-fA-F]+)>\s+<([0-9a-fA-F]+)>/g)) {
      const lo = parseInt(line[1], 16);
      const hi = parseInt(line[2], 16);
      const base = parseInt(line[3], 16);
      for (let c = lo; c <= hi; c += 1) map.set(c, String.fromCodePoint(base + (c - lo)));
    }
  }
  return map;
}

/** Extracts the readable text of a PDF produced by the export builders. */
export function extractPdfText(pdf: Buffer): string {
  const raw = pdf.toString('latin1');

  // Object-number -> inflated stream text for every stream.
  const streams = new Map<number, string>();
  // Object-number -> raw dict text for every indirect object (single-object
  // scope: patterns below must never span `endobj … N 0 obj` boundaries).
  const objects = new Map<number, string>();
  const objRe = /(\d+) 0 obj([\s\S]*?)endobj/g;
  let m: RegExpExecArray | null;
  while ((m = objRe.exec(raw))) {
    const body = m[2];
    objects.set(Number(m[1]), body);
    const sm = /stream\r?\n([\s\S]*?)endstream/.exec(body);
    if (sm) streams.set(Number(m[1]), inflateIfNeeded(Buffer.from(sm[1], 'latin1')).toString('latin1'));
  }

  // Font resource name -> its ToUnicode CMap, resolved within single objects.
  const fontMaps = new Map<string, Map<number, string>>();
  const objNames = new Map<number, string[]>();
  for (const [, body] of objects) {
    const res = /\/Font\s*<<([\s\S]*?)>>/.exec(body);
    if (!res) continue;
    for (const n of res[1].matchAll(/\/([A-Za-z0-9]+)\s+(\d+) 0 R/g)) {
      const list = objNames.get(Number(n[2])) ?? [];
      list.push(n[1]);
      objNames.set(Number(n[2]), list);
    }
  }
  for (const [num, body] of objects) {
    if (!/\/Subtype\s*\/Type0/.test(body)) continue;
    const tu = /\/ToUnicode\s+(\d+) 0 R/.exec(body);
    if (!tu) continue;
    const cmap = parseCMap(streams.get(Number(tu[1])) ?? '');
    for (const name of objNames.get(num) ?? []) fontMaps.set(name, cmap);
  }

  // Walk content streams (Type /Page Contents), tracking the active font.
  const out: string[] = [];
  const pageRe = /\/Type\s*\/Page[^s][\s\S]*?\/Contents\s+(?:\[\s*)?(\d+) 0 R/g;
  while ((m = pageRe.exec(raw))) {
    const content = streams.get(Number(m[1])) ?? '';
    let active = fontMaps.values().next().value as Map<number, string> | undefined;
    for (const line of content.split('\n')) {
      const tf = line.match(/\/([A-Za-z0-9]+)\s+[\d.]+\s+Tf/);
      if (tf && fontMaps.has(tf[1])) active = fontMaps.get(tf[1]);
      if (!/\b(Tj|TJ)\b/.test(line)) continue;
      for (const hx of line.matchAll(/<([0-9a-fA-F]{4,})>/g)) {
        const hex = hx[1];
        let s = '';
        for (let i = 0; i + 4 <= hex.length; i += 4) {
          s += active?.get(parseInt(hex.slice(i, i + 4), 16)) ?? '';
        }
        if (s) out.push(s);
      }
    }
  }
  return out.join(' ');
}

/** One drawn text run with its page-space origin (PDF points, y grows down). */
export interface PdfTextRun {
  page: number;
  text: string;
  x: number;
  y: number;
}

/**
 * Text runs with their coordinates.
 *
 * `extractPdfText` answers "what does the page say"; this answers "where was it
 * drawn", which is the only way a test can prove that two cells do not overlap.
 * PDFKit positions text with `1 0 0 1 x y Tm` (absolute) and `Td` (relative
 * line move), so both operators are tracked.
 */
export function extractPdfRuns(pdf: Buffer): PdfTextRun[] {
  const raw = pdf.toString('latin1');
  const streams = new Map<number, string>();
  const objects = new Map<number, string>();
  const objRe = /(\d+) 0 obj([\s\S]*?)endobj/g;
  let m: RegExpExecArray | null;
  while ((m = objRe.exec(raw))) {
    const body = m[2];
    objects.set(Number(m[1]), body);
    const sm = /stream\r?\n([\s\S]*?)endstream/.exec(body);
    if (sm) streams.set(Number(m[1]), inflateIfNeeded(Buffer.from(sm[1], 'latin1')).toString('latin1'));
  }

  const fontMaps = new Map<string, Map<number, string>>();
  const objNames = new Map<number, string[]>();
  for (const [, body] of objects) {
    const res = /\/Font\s*<<([\s\S]*?)>>/.exec(body);
    if (!res) continue;
    for (const n of res[1].matchAll(/\/([A-Za-z0-9]+)\s+(\d+) 0 R/g)) {
      const list = objNames.get(Number(n[2])) ?? [];
      list.push(n[1]);
      objNames.set(Number(n[2]), list);
    }
  }
  for (const [num, body] of objects) {
    if (!/\/Subtype\s*\/Type0/.test(body)) continue;
    const tu = /\/ToUnicode\s+(\d+) 0 R/.exec(body);
    if (!tu) continue;
    const cmap = parseCMap(streams.get(Number(tu[1])) ?? '');
    for (const name of objNames.get(num) ?? []) fontMaps.set(name, cmap);
  }

  const runs: PdfTextRun[] = [];
  const pageRe = /\/Type\s*\/Page[^s][\s\S]*?\/Contents\s+(?:\[\s*)?(\d+) 0 R/g;
  let page = 0;
  while ((m = pageRe.exec(raw))) {
    page += 1;
    const content = streams.get(Number(m[1])) ?? '';
    let active = fontMaps.values().next().value as Map<number, string> | undefined;
    let x = 0;
    let y = 0;
    for (const line of content.split('\n')) {
      const tf = line.match(/\/([A-Za-z0-9]+)\s+[\d.]+\s+Tf/);
      if (tf && fontMaps.has(tf[1])) active = fontMaps.get(tf[1]);

      const tm = /1 0 0 1 ([\d.-]+) ([\d.-]+) Tm/.exec(line);
      if (tm) {
        x = Number(tm[1]);
        y = Number(tm[2]);
      }
      const td = /([\d.-]+) ([\d.-]+) Td/.exec(line);
      if (td && !tm) {
        x += Number(td[1]);
        y += Number(td[2]);
      }

      if (!/\b(Tj|TJ)\b/.test(line)) continue;
      let text = '';
      for (const hx of line.matchAll(/<([0-9a-fA-F]{4,})>/g)) {
        const hex = hx[1];
        for (let i = 0; i + 4 <= hex.length; i += 4) {
          text += active?.get(parseInt(hex.slice(i, i + 4), 16)) ?? '';
        }
      }
      if (text) runs.push({ page, text, x, y });
    }
  }
  return runs;
}
