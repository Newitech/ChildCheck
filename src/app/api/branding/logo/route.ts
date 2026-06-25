import { NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import path from "node:path";

import { db } from "@/lib/db";
import { BRAND_DIR } from "@/lib/paths";

export const dynamic = "force-dynamic";

const CONTENT_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
};

const PLACEHOLDER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#0f9d8a"/><path d="M32 14a8 8 0 1 0 0 16 8 8 0 0 0 0-16Zm0 22c-9 0-16 4.5-16 10v4h32v-4c0-5.5-7-10-16-10Z" fill="#fff"/></svg>`;

/**
 * GET /api/branding/logo — public. Serves the uploaded org logo with a long
 * cache. Returns a tiny SVG placeholder (404) when no logo is configured.
 */
export async function GET() {
  let filename: string | null = null;
  try {
    const org = await db.organisation.findFirst();
    filename = org?.logoUrl ?? null;
  } catch {
    filename = null;
  }

  if (!filename) {
    return new NextResponse(PLACEHOLDER_SVG, {
      status: 404,
      headers: {
        "Content-Type": "image/svg+xml",
        "Cache-Control": "public, max-age=300",
      },
    });
  }

  // Only serve simple filenames (no path traversal).
  if (!/^logo\.[a-z0-9]+$/i.test(filename)) {
    return new NextResponse(PLACEHOLDER_SVG, {
      status: 404,
      headers: { "Content-Type": "image/svg+xml" },
    });
  }

  const filepath = path.join(BRAND_DIR, filename);
  let buf: Buffer;
  try {
    buf = await fs.readFile(filepath);
  } catch {
    return new NextResponse(PLACEHOLDER_SVG, {
      status: 404,
      headers: { "Content-Type": "image/svg+xml" },
    });
  }

  const ext = path.extname(filename).toLowerCase();
  const contentType = CONTENT_TYPES[ext] ?? "application/octet-stream";

  return new NextResponse(buf, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "public, max-age=3600, immutable",
    },
  });
}
