import { stripVTControlCharacters } from "node:util";

/** Content is plain text. Only the renderer may introduce terminal controls. */
export function plain(value: string): string {
  // eslint-disable-next-line no-control-regex
  return stripVTControlCharacters(value).replace(/[\x00-\x1f\x7f-\x9f]/g, " ");
}
const segments = new Intl.Segmenter(undefined, { granularity: "grapheme" });
function width(value: string): number {
  if (/^\p{Mark}+$/u.test(value)) return 0;
  const code = value.codePointAt(0) ?? 0;
  // Conservatively reserve two cells for emoji and East Asian text. Ambiguous
  // terminal widths can use extra space, but cannot wrap a tracked frame line.
  const wide = code >= 0x1100 && (code <= 0x115f || code === 0x2329 || code === 0x232a
    || (code >= 0x2e80 && code <= 0xa4cf && code !== 0x303f) || (code >= 0xac00 && code <= 0xd7a3)
    || (code >= 0xf900 && code <= 0xfaff) || (code >= 0xfe10 && code <= 0xfe6f)
    || (code >= 0xff00 && code <= 0xff60) || (code >= 0xffe0 && code <= 0xffe6) || code >= 0x20000);
  return /\p{Extended_Pictographic}|\p{Regional_Indicator}/u.test(value) || wide ? 2 : 1;
}
export function cells(value: string): number {
  return [...segments.segment(value)].reduce((total, part) => total + width(part.segment), 0);
}
export function clip(value: string, columns: number): string {
  if (cells(value) <= columns) return value;
  let result = "", used = 0;
  for (const part of segments.segment(value)) {
    const next = width(part.segment);
    if (used + next > columns - 1) break;
    result += part.segment; used += next;
  }
  return `${result}…`;
}
