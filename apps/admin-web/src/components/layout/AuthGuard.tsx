"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Spin } from "antd";
import { useAuth } from "@/lib/auth/auth-provider";

/**
 * Client-side guard for admin routes. Redirects to /login when there is no
 * valid ADMIN session. This is a UX guard only — the backend enforces auth.
 */
export function AuthGuard({ children }: { children: React.ReactNode }) {
  const { user, ready } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (ready && !user) {
      router.replace("/login");
    }
  }, [ready, user, router]);

  if (!ready || !user) {
    return (
      <div className="agri-login">
        <Spin />
      </div>
    );
  }

  return <>{children}</>;
}
