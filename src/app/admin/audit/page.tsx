import { redirect } from "next/navigation";

import { getCurrentUser } from "@/lib/auth";
import { AuditLogViewer } from "./audit-viewer";

export const dynamic = "force-dynamic";

/**
 * /admin/audit — tamper-evident audit-log viewer (Stage 16).
 *
 * Admin-only. Renders a paginated, filterable table of AuditLog rows with
 * per-row tamper badges (recomputed hash vs stored hash) and a "Verify chain
 * integrity" button that walks the whole chain and surfaces the first
 * discrepancy (tampered row, or inserted/deleted row breaking prevHash linkage).
 *
 * Rows that predate the Stage 16 migration (null hash) are shown with an
 * "unhashed" badge and skipped by the verifier — the chain effectively
 * starts from the first row that has a hash.
 */
export default async function AdminAuditPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?callback=/admin/audit");
  if (!user.roles.includes("Admin")) redirect("/admin");

  return <AuditLogViewer />;
}
