"use client";

/**
 * Page column wrapper.
 *
 * On phone screens that keep the bottom tab bar visible, the content gets the
 * tab-bar height as bottom padding so nothing is hidden behind it — the same
 * spacing the Mobile app's tabs leave for every tab screen.
 */

import { usePathname } from "next/navigation";
import { activeTab } from "@/components/layout/nav";

export function AppMain({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const withTabs = activeTab(pathname) !== null;

  return (
    <main className={withTabs ? "agri-has-tabbar" : undefined} style={{ minHeight: "60vh" }}>
      {children}
    </main>
  );
}
