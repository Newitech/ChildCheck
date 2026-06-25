/**
 * RFC-4180 CSV parser.
 *
 * Stage 12 — Import/Export.
 *
 * The writer (`src/lib/csv.ts`) is a one-liner string builder used by the
 * reports exports. This module is its mirror: a streaming-ish parser used by
 * the import API to turn an uploaded .csv file into a list of typed rows.
 *
 * Spec quirks handled (RFC 4180 §2):
 *   - Fields may be quoted with double quotes; quoted fields may contain
 *     commas, newlines, and double-quotes (the latter escaped by doubling:
 *     "" → ").
 *   - Records are separated by CRLF OR a bare LF. We treat either as a row
 *     terminator inside an unquoted field.
 *   - A trailing newline at EOF does NOT create an empty final row.
 *   - Empty lines (other than inside a quoted field) are skipped.
 *   - A header row is returned as `fields` and never appears in `rows`.
 *
 * The parser is a hand-written state machine — no dependency, no RegExp on
 * the whole text (so multi-megabyte files don't blow the stack).
 */

export interface CsvParseResult {
  /** Column headers (trimmed; never null). Empty array if file was empty. */
  fields: string[];
  /** One entry per data row; each entry is the raw string values, in field order. */
  rows: string[][];
  /** Non-fatal parse warnings (e.g. rows whose column count != header count). */
  warnings: string[];
}

/**
 * Parse a CSV string into a header + data rows.
 *
 * Throws on hard parse errors (e.g. unterminated quoted field). The caller
 * should wrap this in try/catch and surface a friendly error.
 */
export function parseCsv(text: string): CsvParseResult {
  // Normalise CRLF → LF but keep CR inside quoted fields handled below.
  // We do NOT split on \n upfront because a quoted field may contain \n.
  const len = text.length;
  const rows: string[][] = [];
  const warnings: string[] = [];

  let i = 0;
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let fieldStartedQuoted = false;

  while (i < len) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        // Doubled quote = escaped quote
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        // Closing quote
        inQuotes = false;
        i += 1;
        continue;
      }
      // Any other char (incl. newline, comma) inside quotes is literal.
      field += ch;
      i += 1;
      continue;
    }

    // Not in quotes.
    if (ch === '"') {
      // Start of a quoted field. If `field` already has content, this is a
      // malformed CSV — we accept it leniently by appending the quoted part.
      inQuotes = true;
      fieldStartedQuoted = true;
      i += 1;
      continue;
    }

    if (ch === ",") {
      row.push(field);
      field = "";
      fieldStartedQuoted = false;
      i += 1;
      continue;
    }

    if (ch === "\r") {
      // CRLF or lone CR — treat as row terminator.
      if (text[i + 1] === "\n") i += 2;
      else i += 1;
      row.push(field);
      field = "";
      fieldStartedQuoted = false;
      // Skip wholly-empty rows (blank lines).
      if (row.some((c) => c.length > 0)) {
        rows.push(row);
      }
      row = [];
      continue;
    }

    if (ch === "\n") {
      row.push(field);
      field = "";
      fieldStartedQuoted = false;
      if (row.some((c) => c.length > 0)) {
        rows.push(row);
      }
      row = [];
      i += 1;
      continue;
    }

    field += ch;
    i += 1;
  }

  // Flush trailing field/row if file didn't end with a newline.
  if (field.length > 0 || row.length > 0 || fieldStartedQuoted) {
    row.push(field);
    if (row.some((c) => c.length > 0)) {
      rows.push(row);
    }
  }

  if (inQuotes) {
    throw new Error("CSV parse error: unterminated quoted field");
  }

  if (rows.length === 0) {
    return { fields: [], rows: [], warnings };
  }

  const fields = rows[0].map((c) => c.trim());
  const dataRows = rows.slice(1);
  const expected = fields.length;

  // Length-mismatch warnings (non-fatal; we pad/truncate when reading).
  dataRows.forEach((r, idx) => {
    if (r.length !== expected) {
      warnings.push(
        `Row ${idx + 2} has ${r.length} columns; expected ${expected}.`,
      );
    }
  });

  return { fields, rows: dataRows, warnings };
}

/**
 * Build a row→object mapper bound to a header set.
 *
 * Returns a function that takes a row's raw string array and produces a
 * Record<columnName, value>. Missing columns (row shorter than header) are
 * returned as "". Extra columns (row longer) are ignored with `__extraN`
 * keys so debug tools can spot them.
 *
 * Lookup is case-insensitive on column name (so a template "FirstName" header
 * matches "firstName" used by the validator).
 */
export function rowMapper(fields: string[]) {
  const normalized = fields.map((f) => f.trim().toLowerCase());
  return function map(row: string[]): Record<string, string> {
    const out: Record<string, string> = {};
    for (let i = 0; i < normalized.length; i++) {
      const key = normalized[i];
      if (!key) continue;
      out[key] = (row[i] ?? "").trim();
    }
    return out;
  };
}

/**
 * Get a value from a mapped row by any of several candidate column names
 * (case-insensitive). Returns "" if none present.
 */
export function pick(
  row: Record<string, string>,
  candidates: string[],
): string {
  for (const c of candidates) {
    const k = c.toLowerCase();
    if (k in row && row[k] !== "") return row[k];
  }
  return "";
}
