import type { ReactNode } from "react";
import { Card } from "antd";
import Link from "next/link";

export function KpiCard({
  label,
  value,
  hint,
  href,
  tone = "default",
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  href?: string;
  tone?: "default" | "success" | "warning" | "error";
}) {
  const color =
    tone === "success"
      ? "var(--agri-green)"
      : tone === "warning"
        ? "#d48806"
        : tone === "error"
          ? "#cf1322"
          : "var(--agri-text)";

  const body = (
    <Card variant="borderless" styles={{ body: { padding: 16 } }} className="agri-kpi-card">
      <div className="agri-kpi-label">{label}</div>
      <div className="agri-kpi-value" style={{ color }}>
        {value}
      </div>
      {hint ? <div className="agri-kpi-label" style={{ marginTop: 4 }}>{hint}</div> : null}
    </Card>
  );

  if (href) {
    return (
      <Link href={href} className="agri-kpi-link">
        {body}
      </Link>
    );
  }
  return body;
}
