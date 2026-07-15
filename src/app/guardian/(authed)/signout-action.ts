"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import {
  GUARDIAN_COOKIE,
  guardianCookieOptions,
} from "@/lib/guardian-session";

/**
 * Server action invoked by the guardian portal's "Sign out" button.
 *
 * Clears the signed guardian session cookie (idempotent) and sends the carer
 * back to the sign-in page. Kept separate from the /api/guardian/signout REST
 * endpoint so the button works as a progressive-enhancement form post without
 * any client JS.
 */
export async function signOutGuardian() {
  const store = await cookies();
  store.set(GUARDIAN_COOKIE, "", {
    ...guardianCookieOptions(),
    maxAge: 0,
  });
  redirect("/guardian");
}
