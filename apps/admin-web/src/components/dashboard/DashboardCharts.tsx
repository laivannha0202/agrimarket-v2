"use client";

import { Bar, Column } from "@ant-design/plots";
import type { ReportsDailyPoint } from "@/types/api";
import { formatMoney, formatNumber } from "@/lib/format";

/** Compact VND for axis ticks: 1,2 tr / 3,4 tỷ / 25 k. */
function compactMoney(value: number): string {
  const n = Math.abs(value);
  if (n >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1).replace(".", ",")} tỷ`;
  if (n >= 1_000_000) return `${(value / 1_000_000).toFixed(1).replace(".", ",")} tr`;
  if (n >= 1_000) return `${Math.round(value / 1_000)} k`;
  return String(value);
}

/** "2026-10-07" -> "07/10". */
function dayLabel(date: string): string {
  const [, m, d] = date.split("-");
  return `${d}/${m}`;
}

/**
 * Revenue by Vietnam day. Real money received (netCollected = collected −
 * refunded), never order value. Single neutral colour, no gradients/effects.
 *
 * A zero-revenue period renders an explicit empty state — never an empty
 * chart with a 0–1 axis that reads as missing data.
 */
export function RevenueByDayChart({ points }: { points: ReportsDailyPoint[] }) {
  const data = points.map((p) => ({
    day: dayLabel(p.date),
    value: p.netCollected,
  }));

  if (data.every((d) => d.value === 0)) {
    return (
      <div
        style={{
          height: 280,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--agri-muted, #888)",
          border: "1px dashed var(--agri-border, #ddd)",
          borderRadius: 8,
        }}
      >
        Chưa có doanh thu trong kỳ
      </div>
    );
  }

  return (
    <Column
      data={data}
      xField="day"
      yField="value"
      height={280}
      autoFit
      containerStyle={{ width: "100%", height: 280 }}
      label={false}
      axis={{
        x: { title: false, labelAutoHide: true, labelAutoRotate: false },
        y: { title: false, labelFormatter: (v: number) => compactMoney(v) },
      }}
      tooltip={{
        title: (d: { day: string }) => d.day,
        items: [{ channel: "y", valueFormatter: (v: number) => formatMoney(v) }],
      }}
      style={{ fill: "#2f8f4e", radiusTopLeft: 3, radiusTopRight: 3 }}
    />
  );
}

/**
 * Order count by status.
 *
 * Horizontal bars, because every label is a Vietnamese phrase ("Đang chuẩn
 * bị", "Chờ xác nhận"). Vertical bars had to rotate those labels 90° — the
 * text became unreadable and the y-axis title ran through the ticks. Rows of
 * text on the left read naturally at any width, including 390px.
 *
 * An all-zero breakdown renders the same explicit empty state as the revenue
 * chart: an axis scaled 0–1 with no bars looks like a rendering failure, not
 * like "no orders in this period".
 */
export function OrdersByStatusChart({
  data,
}: {
  data: { status: string; count: number }[];
}) {
  if (data.length === 0 || data.every((d) => d.count === 0)) {
    return (
      <div
        style={{
          height: 280,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--agri-muted, #888)",
          border: "1px dashed var(--agri-border, #ddd)",
          borderRadius: 8,
        }}
      >
        Chưa có đơn hàng trong kỳ
      </div>
    );
  }

  return (
    <Bar
      data={data}
      // `Bar` is a transposed column chart: the CATEGORY stays on xField and
      // the measure on yField, and the component swaps the axes on screen.
      // Swapping the fields here put the statuses on the value axis, rotated
      // 90° along the bottom.
      xField="status"
      yField="count"
      height={280}
      autoFit
      containerStyle={{ width: "100%", height: 280 }}
      label={false}
      axis={{
        x: { title: false, labelAutoRotate: false, labelAutoHide: false },
        y: { title: false, tickCount: 4, labelFormatter: (v: number) => formatNumber(v) },
      }}
      tooltip={{
        title: (d: { status: string }) => d.status,
        items: [{ channel: "y", valueFormatter: (v: number) => `${formatNumber(v)} đơn` }],
      }}
      style={{ fill: "#2f8f4e", radiusTopLeft: 3, radiusTopRight: 3 }}
    />
  );
}
