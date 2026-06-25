import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { checkForUpdate, getUpdateCommand, getVersion } from "@/lib/version";

export const dynamic = "force-dynamic";

/** GET /api/admin/updates — check for new ChildCheck releases. */
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const force = new URL(req.url).searchParams.get("force") === "1";
  const status = await checkForUpdate({ force });

  return NextResponse.json({
    ...status,
    updateCommand: getUpdateCommand(),
    installType: process.env.CHILDCHECK_DOCKER === "true" ? "docker" : "native",
  });
}
