import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { PHOTOS_DIR } from "@/lib/paths";
import { readEncryptedFile } from "@/lib/crypto";

export const dynamic = "force-dynamic";

/**
 * GET /api/people/[id]/photo
 *
 * Serve a person's verification photo, decrypted from disk via AES-256-GCM.
 * Auth required (any logged-in user). For Stage 3 we allow all logged-in
 * users to see photos; full role/room scoping arrives with classes/rooms in
 * Stage 5. Medical/allergy fields remain detail-gated; photos are part of
 * check-in/out verification so broad visibility is acceptable at this stage.
 *
 * If the person has no photo, returns 404 with a generated initials-avatar
 * SVG (deterministic colour from a hash of first+last names).
 *
 * Photos are NEVER stored under /public — only encrypted on disk under
 * PHOTOS_DIR and decrypted through this API route.
 */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await ctx.params;

  const person = await db.person.findUnique({
    where: { id },
    select: { firstName: true, lastName: true, photoPath: true },
  });
  if (!person) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  if (!person.photoPath) {
    return initialsAvatar(person.firstName, person.lastName, 404);
  }

  // photoPath is a relative path like "people/<personId>.enc".
  const filename = person.photoPath.split("/").pop();
  if (!filename || !/^[A-Za-z0-9_-]+\.enc$/.test(filename)) {
    return NextResponse.json({ error: "invalid photoPath" }, { status: 500 });
  }
  const filepath = `${PHOTOS_DIR}/${filename}`;

  try {
    const buf = await readEncryptedFile(filepath);
    return new NextResponse(new Uint8Array(buf), {
      status: 200,
      headers: {
        "Content-Type": "image/jpeg",
        "Cache-Control": "private, max-age=3600",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    // File missing or decryption failed (tampering / wrong key) — fall back
    // to a generated initials avatar so the UI still renders.
    return initialsAvatar(person.firstName, person.lastName, 200);
  }
}

/**
 * Generate an SVG initials avatar with a deterministic colour derived from a
 * hash of the person's name. Used both for the 404 no-photo case and as a
 * graceful fallback when the encrypted file is unreadable.
 */
function initialsAvatar(
  firstName: string,
  lastName: string,
  status: number,
): NextResponse {
  const initials = `${(firstName[0] ?? "").toUpperCase()}${(lastName[0] ?? "").toUpperCase()}` || "?";
  const hash = hashStr(`${firstName} ${lastName}`);
  const hue = hash % 360;
  const bg = `hsl(${hue}, 55%, 45%)`;
  const fg = `hsl(${hue}, 80%, 95%)`;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="256" height="256">
  <rect width="256" height="256" fill="${bg}" />
  <text x="50%" y="50%" dy="0.1em" text-anchor="middle" dominant-baseline="middle"
        font-family="system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
        font-size="120" font-weight="700" fill="${fg}">${escapeXml(initials)}</text>
</svg>`;

  return new NextResponse(svg, {
    status,
    headers: {
      "Content-Type": "image/svg+xml",
      "Cache-Control": "private, max-age=300",
    },
  });
}

function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

function escapeXml(s: string): string {
  return s.replace(/[<>&'"]/g, (c) => {
    switch (c) {
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case "&":
        return "&amp;";
      case "'":
        return "&apos;";
      case '"':
        return "&quot;";
      default:
        return c;
    }
  });
}
