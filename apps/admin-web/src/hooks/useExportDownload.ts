"use client";

import { useState } from "react";
import { App } from "antd";

/**
 * Triggers a real browser download from a `api.download` result.
 *
 * Shows a loading state on the caller's button and a friendly error when the
 * export fails; success needs no toast — the browser's own download UI is the
 * confirmation.
 */
export function useExportDownload() {
  const { message } = App.useApp();
  const [downloading, setDownloading] = useState<null | "xlsx" | "pdf">(null);

  const download = async (
    format: "xlsx" | "pdf",
    fetch: () => Promise<{ blob: Blob; filename: string }>,
  ) => {
    setDownloading(format);
    try {
      const { blob, filename } = await fetch();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename.endsWith(`.${format}`) ? filename : `${filename}.${format}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5_000);
    } catch (err) {
      message.error(err instanceof Error ? err.message : "Xuất file thất bại. Vui lòng thử lại.");
    } finally {
      setDownloading(null);
    }
  };

  return { downloading, download };
}
