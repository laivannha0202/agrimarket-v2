"use client";

/**
 * Reads the single-use token out of the recovery link's query string and hands
 * it to `ResetPasswordForm`.
 *
 * `useSearchParams` requires a Suspense boundary during prerendering, so this
 * tiny client component exists purely to keep the token read inside one — the
 * page itself stays a server component and can export metadata.
 */

import { useSearchParams } from "next/navigation";
import { ResetPasswordForm } from "@/components/auth/ResetPasswordForm";

export function ResetPasswordTokenGate() {
  const searchParams = useSearchParams();
  return <ResetPasswordForm token={searchParams.get("token")?.trim() ?? ""} />;
}
