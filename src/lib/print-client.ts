/**
 * Stage 11 — Client-side print dispatcher.
 *
 * The kiosk print APIs return one of three driver payloads (browser / qz_tray
 * / thermal_raw). This module is the single entry-point the kiosk UIs use to
 * execute a print: it inspects `method` and runs the right transport.
 *
 *   • browser     → opens a hidden iframe, writes the HTML, calls print().
 *                   Zero-dependency fallback that always works.
 *   • qz_tray     → forwards the payload to the local QZ Tray Java app via
 *                   its HTTP gateway (http://localhost:8181). Requires QZ Tray
 *                   running on the kiosk device — see /admin/printers help.
 *   • thermal_raw → forwards the ESC/POS byte commands to QZ Tray RAW mode.
 *                   Same QZ Tray requirement as above.
 *
 * All three paths resolve to a PrintOutcome describing what happened, so the
 * kiosk UI can show a uniform toast.
 */
import type {
  PrintResult,
  QzPrintPayload,
} from "@/lib/printing";

export interface PrintOutcome {
  ok: boolean;
  method: PrintResult["method"];
  printerName: string;
  /** A human label for the toast, e.g. "Browser print dialog opened". */
  message: string;
}

/**
 * Execute a PrintResult returned from the kiosk print API.
 * Never throws — returns a failed outcome on any error.
 */
export async function executePrint(result: PrintResult): Promise<PrintOutcome> {
  // Capture before narrowing so the catch/fallback branches can access them
  // even after TS narrows `result.method` to `never`.
  const { method, printerName } = result;
  try {
    if (method === "browser") {
      return executeBrowserPrint(result.html, result.kind, printerName);
    }
    if (method === "qz_tray") {
      return await executeQzTray(result.payload, printerName);
    }
    if (method === "thermal_raw") {
      return await executeThermalRaw(
        result.commands,
        printerName,
        result.kind,
      );
    }
    return {
      ok: false,
      method,
      printerName,
      message: "Unknown print method",
    };
  } catch (e) {
    return {
      ok: false,
      method,
      printerName,
      message: e instanceof Error ? e.message : "Print failed",
    };
  }
}

/**
 * Browser print: hidden iframe + window.print().
 *
 * Using an iframe (instead of a popup window) avoids popup-blocker issues on
 * the kiosk. The iframe is removed after the print dialog closes.
 */
function executeBrowserPrint(
  html: string,
  kind: "label" | "slip",
  printerName: string,
): PrintOutcome {
  if (typeof window === "undefined") {
    return {
      ok: false,
      method: "browser",
      printerName,
      message: "Not in browser",
    };
  }
  const iframe = document.createElement("iframe");
  iframe.setAttribute("aria-hidden", "true");
  iframe.style.position = "fixed";
  iframe.style.right = "0";
  iframe.style.bottom = "0";
  iframe.style.width = "0";
  iframe.style.height = "0";
  iframe.style.border = "0";
  iframe.title = kind === "label" ? "Label print" : "Slip print";
  document.body.appendChild(iframe);

  const doc = iframe.contentWindow?.document ?? iframe.contentDocument;
  if (!doc) {
    document.body.removeChild(iframe);
    return {
      ok: false,
      method: "browser",
      printerName,
      message: "Could not open print frame",
    };
  }
  doc.open();
  doc.write(html);
  doc.close();

  // The HTML payload's inline script auto-triggers window.print() once loaded.
  // As a fallback, also schedule a manual trigger.
  setTimeout(() => {
    try {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
    } catch {
      /* ignore */
    }
  }, 600);

  // Clean up the iframe a bit later (give the print dialog time to render).
  setTimeout(() => {
    try {
      if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
    } catch {
      /* ignore */
    }
  }, 60_000);

  return {
    ok: true,
    method: "browser",
    printerName,
    message: "Browser print dialog opened",
  };
}

/**
 * QZ Tray dispatch.
 *
 * QZ Tray (https://qz.io) runs a small Java tray app on the kiosk device and
 * exposes a WebSocket gateway. The official qz-tray.js client wraps the
 * websocket protocol; if it's loaded on the page (window.qz), we use it.
 * Otherwise we attempt the QZ Tray HTTP gateway (http://localhost:8181).
 *
 * If neither is available, we report failure so the kiosk can fall back to
 * showing the print payload as HTML (handled by the caller).
 */
/** Minimal structural type for the qz-tray.js client (loaded optionally on the kiosk page). */
interface QzClient {
  print: (config: unknown, content: unknown) => Promise<void>;
  configs?: {
    create: (
      printer: string,
      opts?: Record<string, unknown>,
    ) => unknown;
  };
  websocket?: {
    connect: () => Promise<void>;
    isActive: () => boolean;
  };
}

function asQzClient(v: unknown): QzClient | null {
  if (v && typeof v === "object" && "print" in v && typeof (v as QzClient).print === "function") {
    return v as QzClient;
  }
  return null;
}

async function executeQzTray(
  payload: QzPrintPayload,
  printerName: string,
): Promise<PrintOutcome> {
  // Try the official qz-tray.js client first, if loaded.
  const qz = asQzClient((window as { qz?: unknown }).qz);
  if (qz) {
    try {
      // The exact API depends on qz-tray.js version; we use the documented
      // public surface: qz.print(config, content).
      if (qz.websocket && typeof qz.websocket.connect === "function") {
        if (!qz.websocket.isActive()) {
          await qz.websocket.connect();
        }
      }
      // Build a minimal config from our payload.options.
      const config = qz.configs
        ? qz.configs.create(payload.printer, {
            units: payload.options.units ?? "mm",
            colorType: payload.options.colorType ?? "color",
            copies: payload.options.copies ?? 1,
            density: payload.options.density,
          })
        : { printer: payload.printer };
      const content = payload.data.map((d) =>
        d.type === "html" ? d.data : { type: "raw", format: "base64", data: d.data },
      );
      await qz.print(config, content);
      return {
        ok: true,
        method: "qz_tray",
        printerName,
        message: `Sent to QZ Tray (${printerName})`,
      };
    } catch (e) {
      return {
        ok: false,
        method: "qz_tray",
        printerName,
        message: e instanceof Error ? e.message : "QZ Tray call failed",
      };
    }
  }

  // Fall back to the HTTP gateway (older QZ Tray installs).
  try {
    const res = await fetch("http://localhost:8181/print", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      return {
        ok: false,
        method: "qz_tray",
        printerName,
        message: `QZ Tray HTTP ${res.status}`,
      };
    }
    return {
      ok: true,
      method: "qz_tray",
      printerName,
      message: `Sent to QZ Tray (${printerName})`,
    };
  } catch {
    return {
      ok: false,
      method: "qz_tray",
      printerName,
      message:
        "QZ Tray not reachable — is the tray app running on this kiosk? See /admin/printers.",
    };
  }
}

/**
 * Thermal raw dispatch: send ESC/POS base64 commands via QZ Tray RAW mode
 * (or, failing that, document the commands for the operator).
 */
async function executeThermalRaw(
  commands: string[],
  printerName: string,
  kind: "label" | "slip",
): Promise<PrintOutcome> {
  const qz = asQzClient((window as { qz?: unknown }).qz);
  if (qz) {
    try {
      if (qz.websocket && typeof qz.websocket.connect === "function") {
        if (!qz.websocket.isActive()) {
          await qz.websocket.connect();
        }
      }
      const config = qz.configs
        ? qz.configs.create(printerName, { forceRaw: true })
        : { printer: printerName };
      const content = commands.map((c) => ({
        type: "raw",
        format: "base64",
        data: c,
      }));
      await qz.print(config, content);
      return {
        ok: true,
        method: "thermal_raw",
        printerName,
        message: `Sent ${commands.length} raw command chunk(s) to ${printerName}`,
      };
    } catch (e) {
      return {
        ok: false,
        method: "thermal_raw",
        printerName,
        message: e instanceof Error ? e.message : "QZ Tray raw call failed",
      };
    }
  }
  // No QZ available — surface as failure so the kiosk can prompt the operator.
  return {
    ok: false,
    method: "thermal_raw",
    printerName,
    message: `QZ Tray required for thermal_raw printing of ${kind} (target: ${printerName}).`,
  };
}
