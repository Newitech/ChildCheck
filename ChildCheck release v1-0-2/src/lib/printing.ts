import { db } from "@/lib/db";

/**
 * Stage 11 — Printing subsystem.
 *
 * This module owns:
 *   - the LabelLayout JSON schema + the default template,
 *   - rendering of labels / signout slips to the 3 driver formats:
 *       • "browser"     → HTML string (kiosk opens a hidden iframe + print).
 *       • "qz_tray"     → QZ Tray payload object (sent to local QZ Java app).
 *       • "thermal_raw" → ESC/POS byte commands as base64 strings.
 *   - lazy seeding of a default LabelTemplate row,
 *   - printer resolution for a given (roomId, purpose).
 *
 * The kiosk print APIs (/api/kiosk/print/{label,slip}) call into here and
 * return the rendered payload. The kiosk client (browser) is responsible for
 * dispatching the right transport based on `method` (see
 * src/lib/print-client.ts).
 */

// ---------------------------------------------------------------------------
// Label layout schema
// ---------------------------------------------------------------------------

export type LabelFieldType =
  | "text"
  | "code"
  | "allergy_icon"
  | "date";

/** Which check-in data the field pulls from. */
export type LabelFieldSource =
  | "childName"
  | "className"
  | "roomName"
  | "dailyCode"
  | "date"
  | "allergy";

export interface LabelField {
  /** Stable id for React keys / form binding. */
  id: string;
  type: LabelFieldType;
  /** What this field displays. */
  field: LabelFieldSource;
  /** X offset in millimetres from the label's left edge. */
  x: number;
  /** Y offset in millimetres from the label's top edge. */
  y: number;
  /** Font size in points. */
  fontSize: number;
  /** Bold? */
  bold?: boolean;
  /** Optional fixed label prepended to the value (e.g. "Class: "). */
  prefix?: string;
}

export interface LabelLayout {
  /** Label width in millimetres (default 101.6 = 4 inches). */
  width: number;
  /** Label height in millimetres (default 50.8 = 2 inches). */
  height: number;
  fields: LabelField[];
}

/** Canonical default layout: 4×2 inch label with the six standard fields. */
export const DEFAULT_LABEL_LAYOUT: LabelLayout = {
  width: 101.6,
  height: 50.8,
  fields: [
    {
      id: "childName",
      type: "text",
      field: "childName",
      x: 5,
      y: 4,
      fontSize: 24,
      bold: true,
    },
    {
      id: "className",
      type: "text",
      field: "className",
      x: 5,
      y: 18,
      fontSize: 12,
      prefix: "Class: ",
    },
    {
      id: "roomName",
      type: "text",
      field: "roomName",
      x: 5,
      y: 27,
      fontSize: 12,
      prefix: "Room: ",
    },
    {
      id: "date",
      type: "date",
      field: "date",
      x: 5,
      y: 36,
      fontSize: 10,
      prefix: "Date: ",
    },
    {
      id: "allergy_icon",
      type: "allergy_icon",
      field: "allergy",
      x: 80,
      y: 4,
      fontSize: 28,
      bold: true,
    },
    {
      id: "dailyCode",
      type: "code",
      field: "dailyCode",
      x: 80,
      y: 32,
      fontSize: 20,
      bold: true,
    },
  ],
};

// ---------------------------------------------------------------------------
// Driver payloads (returned to the kiosk client)
// ---------------------------------------------------------------------------

export type PrintMethod = "browser" | "qz_tray" | "thermal_raw";

export interface PrintResultBrowser {
  ok: true;
  method: "browser";
  html: string;
  printerName: string;
  /** Identifies the kind of artifact (label vs slip) for client-side framing. */
  kind: "label" | "slip";
}

export interface PrintResultQz {
  ok: true;
  method: "qz_tray";
  /** The full QZ Tray payload the client forwards to qz.websocket + qz.print. */
  payload: QzPrintPayload;
  printerName: string;
  kind: "label" | "slip";
}

export interface PrintResultThermal {
  ok: true;
  method: "thermal_raw";
  /** ESC/POS byte commands as base64 strings (one per logical chunk). */
  commands: string[];
  printerName: string;
  kind: "label" | "slip";
}

export type PrintResult =
  | PrintResultBrowser
  | PrintResultQz
  | PrintResultThermal;

/** QZ Tray print payload (subset — what we actually populate). */
export interface QzPrintPayload {
  printer: string;
  options: {
    orientation?: "portrait" | "landscape";
    units?: "mm" | "in";
    colorType?: "color" | "grayscale" | "blackwhite";
    density?: number;
    perSpool?: number;
    copies?: number;
  };
  data: Array<
    | { type: "html"; format: "plain"; data: string }
    | { type: "raw"; format: "base64"; data: string[] }
  >;
}

// ---------------------------------------------------------------------------
// Printer resolution
// ---------------------------------------------------------------------------

export interface ResolvedPrinter {
  id: string;
  name: string;
  driver: string;
  queueName: string | null;
  purpose: string;
}

/**
 * Find the best printer for a given room + purpose.
 * Resolution order:
 *   1. An active printer explicitly assigned to the room whose purpose matches.
 *   2. The org's default active printer whose purpose matches.
 *   3. The first active printer whose purpose matches.
 *   4. null → caller should fall back to "browser" (no printer configured).
 */
export async function resolvePrinter(
  roomId: string | null,
  purpose: "label" | "slip",
): Promise<ResolvedPrinter | null> {
  const matches = (p: { purpose: string }) =>
    p.purpose === "both" || p.purpose === purpose;

  // 1. Room-assigned.
  if (roomId) {
    const assigned = await db.roomPrinter.findFirst({
      where: { roomId, printer: { isActive: true } },
      include: { printer: true },
      orderBy: { printer: { isDefault: "desc" } },
    });
    if (assigned && matches(assigned.printer)) {
      return toResolved(assigned.printer);
    }
  }

  // 2. Default printer.
  const def = await db.printer.findFirst({
    where: { isActive: true, isDefault: true },
    orderBy: { name: "asc" },
  });
  if (def && matches(def)) return toResolved(def);

  // 3. First active matching printer.
  const any = await db.printer.findFirst({
    where: { isActive: true },
    orderBy: [{ isDefault: "desc" }, { name: "asc" }],
  });
  if (any && matches(any)) return toResolved(any);

  // 4. Truly nothing — return the first active printer regardless of purpose,
  //    or null if there are no printers at all (caller falls back to browser).
  const last = await db.printer.findFirst({
    where: { isActive: true },
    orderBy: [{ isDefault: "desc" }, { name: "asc" }],
  });
  return last ? toResolved(last) : null;
}

function toResolved(p: {
  id: string;
  name: string;
  driver: string;
  queueName: string | null;
  purpose: string;
}): ResolvedPrinter {
  return {
    id: p.id,
    name: p.name,
    driver: p.driver,
    queueName: p.queueName,
    purpose: p.purpose,
  };
}

/**
 * Returns a ResolvedPrinter even when nothing is configured — synthesises a
 * "browser" fallback so the API always returns something the client can act on.
 */
export function fallbackBrowserPrinter(): ResolvedPrinter {
  return {
    id: "browser",
    name: "Browser print",
    driver: "browser",
    queueName: null,
    purpose: "both",
  };
}

// ---------------------------------------------------------------------------
// Label template DB helpers
// ---------------------------------------------------------------------------

/**
 * Get the default label template, lazily seeding one on first call.
 * Returns the parsed layout.
 */
export async function getDefaultLabelLayout(): Promise<LabelLayout> {
  // Try the marked-default template first, then any template, else seed.
  const existing =
    (await db.labelTemplate.findFirst({
      where: { isDefault: true },
      orderBy: { updatedAt: "desc" },
    })) ??
    (await db.labelTemplate.findFirst({
      orderBy: { updatedAt: "desc" },
    }));

  if (existing) {
    return parseLayout(existing.layout);
  }

  // Seed default.
  await db.labelTemplate.create({
    data: {
      name: "Default label",
      layout: JSON.stringify(DEFAULT_LABEL_LAYOUT),
      isDefault: true,
    },
  });
  return DEFAULT_LABEL_LAYOUT;
}

/** Parse + validate a stored layout JSON, falling back to default on error. */
export function parseLayout(raw: string): LabelLayout {
  try {
    const parsed = JSON.parse(raw) as Partial<LabelLayout>;
    if (
      typeof parsed.width === "number" &&
      typeof parsed.height === "number" &&
      Array.isArray(parsed.fields)
    ) {
      return {
        width: parsed.width,
        height: parsed.height,
        fields: parsed.fields.map((f) => ({
          id: String(f?.id ?? Math.random().toString(36).slice(2)),
          type: (f?.type as LabelFieldType) ?? "text",
          field: (f?.field as LabelFieldSource) ?? "childName",
          x: Number(f?.x ?? 0),
          y: Number(f?.y ?? 0),
          fontSize: Number(f?.fontSize ?? 12),
          bold: Boolean(f?.bold),
          prefix: f?.prefix ?? undefined,
        })),
      };
    }
  } catch {
    /* fall through */
  }
  return DEFAULT_LABEL_LAYOUT;
}

// ---------------------------------------------------------------------------
// Label data + rendering
// ---------------------------------------------------------------------------

export interface LabelData {
  childName: string;
  className: string | null;
  roomName: string | null;
  dailyCode: string;
  date: string; // pre-formatted human date
  allergy: string | null;
}

export interface SlipChildRow {
  name: string;
  className: string | null;
  roomName: string | null;
}

export interface SlipData {
  familyName: string;
  dailyCode: string;
  date: string;
  children: SlipChildRow[];
}

const esc = (s: string): string =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const MM_PER_IN = 25.4;

/**
 * Render a label to a complete HTML document (browser + QZ-HTML drivers).
 * Uses CSS @page size = label dimensions, with absolutely-positioned fields
 * matching the layout. All units in mm.
 */
export function renderLabelHtml(layout: LabelLayout, data: LabelData): string {
  const wMm = layout.width;
  const hMm = layout.height;
  const fields = layout.fields
    .map((f) => {
      const val = fieldValue(f.field, data);
      const baseStyle = [
        `left:${f.x}mm`,
        `top:${f.y}mm`,
        `font-size:${f.fontSize}pt`,
        `font-weight:${f.bold ? 700 : 400}`,
        "position:absolute",
        "white-space:nowrap",
        "line-height:1.1",
        "font-family:Arial,Helvetica,sans-serif",
        "color:#000",
      ].join(";");
      if (f.type === "allergy_icon") {
        if (!data.allergy) return "";
        return `<div style="${baseStyle};color:#b91c1c;" aria-label="Allergy alert">⚠</div>`;
      }
      if (f.type === "code") {
        return `<div style="${baseStyle};font-family:'Courier New',monospace;letter-spacing:1px;">${esc(val)}</div>`;
      }
      const text = f.prefix ? `${f.prefix}${val}` : val;
      return `<div style="${baseStyle}">${esc(text)}</div>`;
    })
    .join("\n      ");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Label — ${esc(data.childName)}</title>
<style>
  @page { size: ${wMm}mm ${hMm}mm; margin: 0; }
  html, body { margin: 0; padding: 0; background: #fff; }
  .label {
    position: relative;
    width: ${wMm}mm;
    height: ${hMm}mm;
    overflow: hidden;
    background: #fff;
  }
  @media print {
    .label { box-shadow: none; }
  }
</style>
</head>
<body>
  <div class="label">
      ${fields}
  </div>
  <script>
    // Auto-trigger print once loaded, then close the window/iframe afterwards.
    (function () {
      function go() {
        try { window.focus(); window.print(); } catch (e) {}
      }
      if (document.readyState === "complete") setTimeout(go, 100);
      else window.addEventListener("load", function () { setTimeout(go, 100); });
    })();
  </script>
</body>
</html>`;
}

/** Render the signout slip to a complete HTML document. */
export function renderSlipHtml(data: SlipData): string {
  const slipWidthMm = 80; // ~3.1 inches — typical receipt width
  const childrenRows = data.children
    .map(
      (c) =>
        `<tr><td style="padding:2px 0;font-weight:600;">${esc(c.name)}</td><td style="padding:2px 0;text-align:right;color:#444;">${esc(c.className ?? "—")}${c.roomName ? ` · ${esc(c.roomName)}` : ""}</td></tr>`,
    )
    .join("");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Signout slip — ${esc(data.familyName)}</title>
<style>
  @page { size: ${slipWidthMm}mm auto; margin: 4mm; }
  html, body { margin: 0; padding: 0; background: #fff; font-family: Arial, Helvetica, sans-serif; color: #000; }
  .slip { width: ${slipWidthMm}mm; padding: 4mm 4mm 6mm; box-sizing: border-box; }
  h1 { font-size: 12pt; margin: 0 0 2mm; text-align: center; }
  .code { text-align: center; font-family: 'Courier New', monospace; font-weight: 700; font-size: 56pt; letter-spacing: 4px; line-height: 1; margin: 4mm 0 2mm; }
  .hint { text-align: center; font-size: 9pt; color: #444; margin-bottom: 4mm; }
  table { width: 100%; border-collapse: collapse; font-size: 10pt; }
  .meta { font-size: 9pt; color: #444; text-align: center; margin-top: 4mm; border-top: 1px dashed #999; padding-top: 3mm; }
</style>
</head>
<body>
  <div class="slip">
    <h1>Today's signout code</h1>
    <div class="code">${esc(data.dailyCode)}</div>
    <div class="hint">Show this code to collect your ${esc(data.children.length === 1 ? "child" : "children")}.</div>
    <table>
      <tbody>
        ${childrenRows}
      </tbody>
    </table>
    <div class="meta">
      ${esc(data.familyName)} · ${esc(data.date)}
    </div>
  </div>
  <script>
    (function () {
      function go() { try { window.focus(); window.print(); } catch (e) {} }
      if (document.readyState === "complete") setTimeout(go, 100);
      else window.addEventListener("load", function () { setTimeout(go, 100); });
    })();
  </script>
</body>
</html>`;
}

/** Get the display string for a given field source. */
function fieldValue(field: LabelFieldSource, data: LabelData): string {
  switch (field) {
    case "childName":
      return data.childName;
    case "className":
      return data.className ?? "—";
    case "roomName":
      return data.roomName ?? "—";
    case "dailyCode":
      return data.dailyCode;
    case "date":
      return data.date;
    case "allergy":
      return data.allergy ?? "";
  }
}

// ---------------------------------------------------------------------------
// Thermal / ESC-POS rendering
// ---------------------------------------------------------------------------

/**
 * Render a label to a list of ESC/POS byte commands (base64 strings).
 * Each entry is a self-contained ESC/POS chunk the printer can consume.
 *
 * This is a deliberately simple renderer: name (large), class, room, code,
 * allergy warning, date. Most thermal label printers accept ESC/POS via a
 * CUPS raw queue or QZ Tray's RAW mode.
 */
export function renderLabelThermal(
  _layout: LabelLayout,
  data: LabelData,
): string[] {
  const cmds: number[] = [];
  // ESC @ — initialise printer
  cmds.push(0x1b, 0x40);
  // ESC a 1 — centre alignment
  cmds.push(0x1b, 0x61, 0x01);
  // ESC ! 0x30 — double width + height
  cmds.push(0x1b, 0x21, 0x30);
  pushText(cmds, data.childName);
  cmds.push(0x0a);
  // ESC ! 0x00 — normal
  cmds.push(0x1b, 0x21, 0x00);
  if (data.className) {
    pushText(cmds, `Class: ${data.className}`);
    cmds.push(0x0a);
  }
  if (data.roomName) {
    pushText(cmds, `Room: ${data.roomName}`);
    cmds.push(0x0a);
  }
  if (data.allergy) {
    // ESC ! 0x10 — double height (emphasis for allergy)
    cmds.push(0x1b, 0x21, 0x10);
    pushText(cmds, `ALLERGY: ${data.allergy}`);
    cmds.push(0x0a);
    cmds.push(0x1b, 0x21, 0x00);
  }
  // Daily code large
  cmds.push(0x1b, 0x21, 0x30);
  pushText(cmds, `Code: ${data.dailyCode}`);
  cmds.push(0x0a);
  cmds.push(0x1b, 0x21, 0x00);
  pushText(cmds, data.date);
  cmds.push(0x0a, 0x0a, 0x0a);
  // GS V 1 — cut paper
  cmds.push(0x1d, 0x56, 0x01);
  return [toBase64(Uint8Array.from(cmds))];
}

/** Render the signout slip to ESC/POS commands (base64 strings). */
export function renderSlipThermal(data: SlipData): string[] {
  const cmds: number[] = [];
  cmds.push(0x1b, 0x40);
  cmds.push(0x1b, 0x61, 0x01); // centre
  cmds.push(0x1b, 0x21, 0x30); // double width+height
  pushText(cmds, "SIGNOUT CODE");
  cmds.push(0x0a);
  cmds.push(0x1d, 0x57, 0x02, 0x00); // GS W — double width + height for the code
  pushText(cmds, data.dailyCode);
  cmds.push(0x0a);
  cmds.push(0x1d, 0x57, 0x01, 0x00); // reset
  cmds.push(0x1b, 0x21, 0x00);
  pushText(cmds, `${data.familyName} · ${data.date}`);
  cmds.push(0x0a, 0x0a);
  cmds.push(0x1b, 0x61, 0x00); // left
  cmds.push(0x1b, 0x21, 0x08); // emphasised
  pushText(cmds, "Children:");
  cmds.push(0x0a);
  cmds.push(0x1b, 0x21, 0x00);
  for (const c of data.children) {
    const line = `  ${c.name}${c.className ? ` — ${c.className}` : ""}${c.roomName ? ` (${c.roomName})` : ""}`;
    pushText(cmds, line);
    cmds.push(0x0a);
  }
  cmds.push(0x0a, 0x0a, 0x0a);
  cmds.push(0x1d, 0x56, 0x01); // cut
  return [toBase64(Uint8Array.from(cmds))];
}

function pushText(arr: number[], s: string): void {
  // Encode UTF-8 — simple chars only for label/slip text.
  const bytes = Buffer.from(s, "utf8");
  for (const b of bytes) arr.push(b);
}

function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

// ---------------------------------------------------------------------------
// Top-level dispatch: data + printer → PrintResult
// ---------------------------------------------------------------------------

/**
 * Build a PrintResult for a label, given the resolved printer + label data.
 * Caller has already fetched the data; this just renders into the right shape.
 */
export function dispatchLabel(
  printer: ResolvedPrinter,
  layout: LabelLayout,
  data: LabelData,
): PrintResult {
  const printerName = printer.queueName ?? printer.name;
  const kind: "label" | "slip" = "label";

  if (printer.driver === "qz_tray") {
    const html = renderLabelHtml(layout, data);
    const payload: QzPrintPayload = {
      printer: printerName,
      options: {
        orientation: "portrait",
        units: "mm",
        colorType: "color",
        density: 203,
        copies: 1,
      },
      data: [{ type: "html", format: "plain", data: html }],
    };
    return {
      ok: true,
      method: "qz_tray",
      payload,
      printerName,
      kind,
    };
  }

  if (printer.driver === "thermal_raw") {
    const commands = renderLabelThermal(layout, data);
    // The client sends `commands` (base64 ESC/POS byte chunks) via QZ Tray
    // RAW mode or directly to a CUPS raw queue named `printerName`.
    return {
      ok: true,
      method: "thermal_raw",
      commands,
      printerName,
      kind,
    };
  }

  // Default: browser.
  return {
    ok: true,
    method: "browser",
    html: renderLabelHtml(layout, data),
    printerName,
    kind,
  };
}

/** Build a PrintResult for a signout slip. */
export function dispatchSlip(
  printer: ResolvedPrinter,
  data: SlipData,
): PrintResult {
  const printerName = printer.queueName ?? printer.name;
  const kind: "label" | "slip" = "slip";

  if (printer.driver === "qz_tray") {
    const html = renderSlipHtml(data);
    const payload: QzPrintPayload = {
      printer: printerName,
      options: {
        orientation: "portrait",
        units: "mm",
        colorType: "color",
        density: 203,
        copies: 1,
      },
      data: [{ type: "html", format: "plain", data: html }],
    };
    return { ok: true, method: "qz_tray", payload, printerName, kind };
  }

  if (printer.driver === "thermal_raw") {
    const commands = renderSlipThermal(data);
    return {
      ok: true,
      method: "thermal_raw",
      commands,
      printerName,
      kind,
    };
  }

  return {
    ok: true,
    method: "browser",
    html: renderSlipHtml(data),
    printerName,
    kind,
  };
}

/** Format a Date as a human label, e.g. "Sat 24 May 2025". */
export function formatPrintDate(d: Date): string {
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const months = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  return `${days[d.getDay()]} ${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
}

// Re-export for tests / UI consumers needing dimensions.
export const INCH_MM = MM_PER_IN;
