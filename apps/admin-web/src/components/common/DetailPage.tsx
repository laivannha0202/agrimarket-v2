"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { Button } from "antd";
import { ArrowLeftOutlined } from "@ant-design/icons";
import { PageHeader } from "@/components/common/PageHeader";
import { PageLoading, ErrorState } from "@/components/common/States";

interface DetailPageProps {
  title: ReactNode;
  subtitle?: ReactNode;
  backHref: string;
  backLabel: string;
  loading?: boolean;
  error?: unknown;
  onRetry?: () => void;
  extra?: ReactNode;
  children: ReactNode;
}

/** Standard detail page: back link, header and content with load/error states. */
export function DetailPage({
  title,
  subtitle,
  backHref,
  backLabel,
  loading,
  error,
  onRetry,
  extra,
  children,
}: DetailPageProps) {
  return (
    <>
      <div style={{ marginBottom: 8 }}>
        <Link href={backHref}>
          <Button type="link" size="small" icon={<ArrowLeftOutlined />} style={{ paddingInline: 0 }}>
            {backLabel}
          </Button>
        </Link>
      </div>
      <PageHeader title={title} subtitle={subtitle} extra={extra} />
      {loading ? (
        <PageLoading />
      ) : error ? (
        <ErrorState onRetry={onRetry} message={error instanceof Error ? error.message : undefined} />
      ) : (
        children
      )}
    </>
  );
}

/** White card wrapper used for detail sections. */
export function DetailCard({
  title,
  extra,
  children,
}: {
  title?: ReactNode;
  extra?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="agri-card" style={{ padding: 16 }}>
      {title || extra ? (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            marginBottom: 12,
          }}
        >
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>{title}</h3>
          {extra}
        </div>
      ) : null}
      {children}
    </div>
  );
}
