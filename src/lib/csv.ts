import fs from 'node:fs';

/**
 * Minimal RFC-4180-ish CSV parser. The TNT data has no embedded newlines but we
 * still handle quoted fields and escaped quotes defensively. Returns an array of
 * objects keyed by the header row. A leading UTF-8 BOM is stripped.
 */
export function parseCsv(text: string): Record<string, string>[] {
  const clean = text.replace(/^﻿/, '');
  const rows: string[][] = [];
  let field = '';
  let record: string[] = [];
  let inQuotes = false;

  for (let i = 0; i < clean.length; i++) {
    const c = clean[i];
    if (inQuotes) {
      if (c === '"') {
        if (clean[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      record.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && clean[i + 1] === '\n') i++;
      record.push(field);
      field = '';
      if (record.some((f) => f !== '')) rows.push(record);
      record = [];
    } else {
      field += c;
    }
  }
  // trailing field/record with no newline
  if (field !== '' || record.length) {
    record.push(field);
    if (record.some((f) => f !== '')) rows.push(record);
  }

  if (!rows.length) return [];
  const header = rows[0].map((h) => h.trim());
  return rows.slice(1).map((r) => {
    const obj: Record<string, string> = {};
    header.forEach((h, idx) => {
      // A blank header (the stray 19th column) is ignored.
      if (h) obj[h] = (r[idx] ?? '').trim();
    });
    return obj;
  });
}

export function readCsvFile(path: string): Record<string, string>[] {
  return parseCsv(fs.readFileSync(path, 'utf8'));
}
