"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { resources } from "@/lib/api/resources";
import { queryKeys } from "@/lib/query/keys";

/**
 * Dashboard data.
 *
 * KPIs come from the backend aggregate `GET /reports/summary` (counts and
 * sums over the full filtered set — never a capped list). The revenue chart
 * uses `GET /reports/daily`. Both are asked for the **same** window (`days`,
 * 7 or 30, ending today) so the KPI total reconciles with the chart sum.
 * Only the "recent orders" table still uses a list query, capped at 8 rows.
 */
export function useDashboardData() {
  const [days, setDays] = useState<7 | 30>(7);

  const summary = useQuery({
    queryKey: queryKeys.reportsSummary({ scope: "dashboard", days }),
    queryFn: () => resources.reportsSummary({ days }),
  });

  const daily = useQuery({
    queryKey: queryKeys.reportsDaily({ scope: "dashboard", days }),
    queryFn: () => resources.reportsDaily({ days }),
  });

  const recent = useQuery({
    queryKey: queryKeys.orders({ scope: "dashboard-recent" }),
    queryFn: () => resources.orders({ limit: 8 }),
  });

  const isLoading = summary.isLoading || daily.isLoading || recent.isLoading;
  const isError = summary.isError || daily.isError || recent.isError;

  const refetchAll = () => {
    void summary.refetch();
    void daily.refetch();
    void recent.refetch();
  };

  const s = summary.data;
  const orderList = recent.data?.data ?? [];

  const statusBreakdown = [
    "PENDING_CONFIRMATION",
    "CONFIRMED",
    "PREPARING",
    "READY_TO_SHIP",
    "SHIPPING",
    "DELIVERED",
    "CANCELLED",
  ].map((status) => ({
    status,
    count: s?.orders.byStatus[status] ?? 0,
  }));

  return {
    isLoading,
    isError,
    refetchAll,
    days,
    setDays,
    /** Actual window the KPIs were computed over (ISO), straight from the API. */
    windowFrom: s?.from,
    windowTo: s?.to,
    dailyPoints: daily.data?.points ?? [],
    kpi: {
      totalOrderValue: s?.orders.totalOrderValue ?? 0,
      grossCollected: s?.revenue.grossCollected ?? 0,
      netCollected: s?.revenue.netCollected ?? 0,
      refundTotal: s?.revenue.refundTotal ?? 0,
      orderCount: s?.orders.count ?? 0,
      activeOrderCount: s?.orders.activeCount ?? 0,
      pendingOrderCount: s?.orders.pendingConfirmation ?? 0,
      shippingOrderCount: s?.orders.shipping ?? 0,
      commission: s?.commissionRecorded ?? 0,
      aov: s?.orders.averageOrderValue ?? 0,
    },
    actionQueue: {
      pendingQcCount: s?.lots.pendingQc ?? 0,
      pendingCertCount: s?.certificates.pending ?? 0,
      openComplaintCount: s?.complaints.open ?? 0,
      openReturnCount: s?.returns.open ?? 0,
      lowStockLineCount: s?.inventory.lowStockLines ?? 0,
      lowStockThreshold: s?.inventory.lowStockThreshold ?? 0,
      expiringCount: s?.lots.sellableExpiring7d ?? 0,
      expiredCount: s?.lots.sellableExpired ?? 0,
    },
    recentOrders: [...orderList].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    ),
    statusBreakdown,
  };
}
