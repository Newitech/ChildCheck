/**
 * CSV helper — RFC-4180-ish CSV writer.
 *
 * - Always emits a header row.
 * - Each row is an array of values; values are coerced to strings, and any
 *   value containing a comma, double-quote, or newline is wrapped in double
 *   quotes with internal double-quotes escaped by doubling.
 * - Numbers/booleans/null are stringified sensibly (null → "").
 *
 * Used by the Stage 10 reports API routes to produce downloadable .csv files.
 */

export type CsvValue = string | number | boolean | null | undefined;

/** Escape a single CSV field per RFC-4180 rules. */
export function csvEscape(value: CsvValue): string {
  if (value == null) return "";
  const str = typeof value === "string" ? value : String(value);
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/** Build a single CSV line from an array of values. */
export function csvLine(values: CsvValue[]): string {
  return values.map((v) => csvEscape(v)).join(",");
}

/**
 * Build a complete CSV document from a header + rows.
 *
 * Trailing newline is omitted (callers can add one if they want).
 */
export function buildCsv(header: string[], rows: CsvValue[][]): string {
  const lines = [csvLine(header), ...rows.map((r) => csvLine(r))];
  return lines.join("\n");
}

/**
 * Standard headers for an HTTP response that downloads a .csv file in the
 * browser. `filename` should include the `.csv` extension.
 */
export function csvResponseHeaders(filename: string): Record<string, string> {
  return {
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": `attachment; filename="${filename}"`,
    "Cache-Control": "no-store",
  };
}
