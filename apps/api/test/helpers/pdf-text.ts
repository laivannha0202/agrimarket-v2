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
 * everything PDFKit emits. Anything fancier belongs in a real PDF library.
 */

function inflateIfNeeded(raw: Buffer): Buffer {
  try {
    return inflateSync(raw);
  } catch {
    return raw;
  }
}

function parseCMap(cmap: string): Map<number, string> {
  const map = new Map<number, string>();
  for (const bf of cmap.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const line of bf[1].matchAll(/<([0-9a-fA-F]+)>\s+<([0-9a-fA-F]+)>/g)) {
      map.set(parseInt(line[1], 16), String.fromCodePoint(parseInt(line[2], 16)));
    }
  }
  for (const bf of cmap.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    let body = bf[1];
    // Array form first, then strip it so the pair/triple patterns cannot
    // match *inside* destination arrays.
    for (const line of body.matchAll(
      /<([0-9a-fA-F]+)>\s+<([0-9a-fA-F]+)>\s+\[([0-9a-fA-F<>\s]+)\]/g,
    )) {
      const lo = parseInt(line[1], 16);
      const dsts = [...line[3].matchAll(/<([0-9a-fA-F]+)>/g)].map((d) => parseInt(d[1], 16));
      dsts.forEach((d, i) => map.set(lo + i, String.fromCodePoint(d)));
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
