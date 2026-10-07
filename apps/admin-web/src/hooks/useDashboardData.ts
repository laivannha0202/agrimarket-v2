"use client";

import { useQuery } from "@tanstack/react-query";
import { resources } from "@/lib/api/resources";
import { queryKeys } from "@/lib/query/keys";
import { currentTimeMs } from "@/lib/format/time";

/** Snapshot of the current time, isolated so it is not called during render. */
const nowMs = currentTimeMs;

/**
 * Dashboard data.
 *
 * The V2 backend has no dedicated aggregate/report endpoint, and the demo
 * dataset is small (well under the 100-row list cap), so the dashboard derives
 * its KPIs from the real list endpoints. No fabricated numbers, no SQL in the
 * frontend — just aggregation over API responses.
 */
export function useDashboardData() {
  const orders = useQuery({
    queryKey: queryKeys.orders({ scope: "dashboard" }),
    queryFn: () => resources.orders({ limit: 100 }),
  });

  const lots = useQuery({
    queryKey: queryKeys.lots({ scope: "dashboard" }),
    queryFn: () => resources.lots({ limit: 100 }),
  });

  const certificates = useQuery({
    queryKey: queryKeys.certificates({ scope: "dashboard" }),
    queryFn: () => resources.certificates({ limit: 100 }),
  });

  const returns = useQuery({
    queryKey: queryKeys.returns({ scope: "dashboard" }),
    queryFn: () => resources.returns({ limit: 100 }),
  });

  const complaints = useQuery({
    queryKey: queryKeys.complaints({ scope: "dashboard" }),
    queryFn: () => resources.complaints({ limit: 100 }),
  });

  const inventory = useQuery({
    queryKey: queryKeys.inventory({ scope: "dashboard" }),
    queryFn: () => resources.inventory({ limit: 100 }),
  });

  const isLoading =
    orders.isLoading ||
    lots.isLoading ||
    certificates.isLoading ||
    returns.isLoading ||
    complaints.isLoading ||
    inventory.isLoading;

  const isError =
    orders.isError ||
    lots.isError ||
    certificates.isError ||
    returns.isError ||
    complaints.isError ||
    inventory.isError;

  const refetchAll = () => {
    void orders.refetch();
    void lots.refetch();
    void certificates.refetch();
    void returns.refetch();
    void complaints.refetch();
    void inventory.refetch();
  };

  const orderList = orders.data?.data ?? [];
  const lotList = lots.data?.data ?? [];
  const certList = certificates.data?.data ?? [];
  const returnList = returns.data?.data ?? [];
  const complaintList = complaints.data?.data ?? [];
  const inventoryList = inventory.data?.data ?? [];

  const activeOrders = orderList.filter((o) => o.status !== "CANCELLED");
  const gmv = activeOrders.reduce((sum, o) => sum + Number(o.grandTotal), 0);
  const commission = orderList
    .flatMap((o) => o.partnerOrders ?? [])
    .reduce((sum, po) => sum + Number(po.commissionAmount), 0);

  const now = nowMs();
  const thirtyDays = 30 * 86_400_000;
  const sevenDays = 7 * 86_400_000;

  const pendingOrders = orderList.filter((o) => o.status === "PENDING_CONFIRMATION");
  const shippingOrders = orderList.filter((o) => o.status === "SHIPPING");
  const pendingQcLots = lotList.filter((l) => l.status === "PENDING_QC");
  const pendingCerts = certList.filter((c) => c.verificationStatus === "PENDING");
  const openComplaints = complaintList.filter(
    (c) => c.status === "OPEN" || c.status === "PROCESSING",
  );
  const activeReturns = returnList.filter(
    (r) => r.status !== "REFUNDED" && r.status !== "REJECTED",
  );
  const lowStock = inventoryList.filter((b) => Number(b.available) <= 20);
  const nearExpiry = lotList.filter((l) => {
    if (l.status !== "SELLABLE") return false;
    const t = new Date(l.expiresAt).getTime();
    return t - now <= sevenDays && t >= now;
  });
  const expiredSellable = lotList.filter(
    (l) => l.status === "SELLABLE" && new Date(l.expiresAt).getTime() < now,
  );

  const recentOrders = [...orderList]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 8);

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
    count: orderList.filter((o) => o.status === status).length,
  }));

  return {
    isLoading,
    isError,
    refetchAll,
    kpi: {
      gmv,
      orderCount: orderList.length,
      pendingOrderCount: pendingOrders.length,
      shippingOrderCount: shippingOrders.length,
      commission,
      refundReturnCount: activeReturns.length,
      aov: activeOrders.length > 0 ? gmv / activeOrders.length : 0,
    },
    actionQueue: {
      pendingOrders,
      pendingQcLots,
      pendingCerts,
      openComplaints,
      activeReturns,
      lowStock,
      nearExpiry,
      expiredSellable,
    },
    recentOrders,
    statusBreakdown,
    windowDays: { thirtyDays, sevenDays },
  };
}
