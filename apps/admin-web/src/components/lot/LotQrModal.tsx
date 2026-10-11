"use client";

import { useMemo, useRef } from "react";
import { Alert, App, Button, Modal, QRCode, Typography } from "antd";
import type { QRCodeRef } from "antd";
import { DownloadOutlined, PrinterOutlined } from "@ant-design/icons";
import { InfoDescriptions } from "@/components/common/InfoDescriptions";
import {
  buildQrLabelHtml,
  isValidTraceCode,
  printHtmlDocument,
  resolveTraceQrPayload,
} from "@/lib/qr-label";
import type { ProductLot } from "@/types/api";

interface LotQrModalProps {
  open: boolean;
  lot: ProductLot | null;
  onClose: () => void;
}

/**
 * "Xem QR / Tải ảnh QR / In tem QR" for one lot.
 *
 * The encoded payload comes from `resolveTraceQrPayload` — the lot's REAL
 * trace code from the backend, either as a public trace-page URL (when
 * `NEXT_PUBLIC_TRACE_BASE_URL` is configured) or as the bare code. The modal
 * shows the exact payload so an admin can verify what will be scanned.
 *
 * Export (download/print) reads pixels from a hidden higher-resolution QR
 * canvas, because the on-screen one is only 220 px wide — too coarse for a
 * 34 mm print.
 */
export function LotQrModal({ open, lot, onClose }: LotQrModalProps) {
  const { message } = App.useApp();
  const exportRef = useRef<QRCodeRef>(null);

  const traceCode = (lot?.traceCode ?? "").trim().toUpperCase();
  const payload = useMemo(
    () => resolveTraceQrPayload(traceCode, process.env.NEXT_PUBLIC_TRACE_BASE_URL),
    [traceCode],
  );
  const isPublicUrl = payload.startsWith("https://");

  /** PNG data URL of the high-resolution QR canvas, or null if unavailable. */
  const readQrDataUrl = (): string | null => {
    const canvas = exportRef.current?.nativeElement?.querySelector("canvas");
    if (!canvas) return null;
    try {
      const url = canvas.toDataURL("image/png");
      return url && url.startsWith("data:image") ? url : null;
    } catch {
      return null;
    }
  };

  const handleDownload = () => {
    const dataUrl = readQrDataUrl();
    if (!dataUrl) {
      message.error("Không tạo được ảnh QR trên trình duyệt này. Vui lòng thử lại.");
      return;
    }
    const anchor = document.createElement("a");
    anchor.href = dataUrl;
    anchor.download = `QR-${traceCode}.png`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  };

  const handlePrint = () => {
    const dataUrl = readQrDataUrl();
    if (!dataUrl) {
      message.error("Không tạo được ảnh QR trên trình duyệt này. Vui lòng thử lại.");
      return;
    }
    printHtmlDocument(
      buildQrLabelHtml({
        qrDataUrl: dataUrl,
        productName: lot?.product?.name ?? "",
        lotCode: lot?.code ?? "",
        traceCode,
      }),
    );
  };

  return (
    <Modal
      open={open && !!lot}
      title="Mã QR truy xuất của lô"
      onCancel={onClose}
      width={480}
      centered
      footer={
        payload ? (
          [
            <Button key="close" onClick={onClose}>
              Đóng
            </Button>,
            <Button key="download" icon={<DownloadOutlined />} onClick={handleDownload}>
              Tải ảnh QR
            </Button>,
            <Button key="print" type="primary" icon={<PrinterOutlined />} onClick={handlePrint}>
              In tem QR
            </Button>,
          ]
        ) : (
          <Button onClick={onClose}>Đóng</Button>
        )
      }
    >
      {!payload ? (
        <Alert
          type="warning"
          showIcon
          title="Lô này chưa có mã truy xuất hợp lệ"
          description="Không thể tạo QR cho lô khi mã truy xuất không đúng định dạng TRC-XXXXXX-XXXX. Vui lòng kiểm tra lại dữ liệu lô."
        />
      ) : (
        <>
          <div style={{ textAlign: "center" }}>
            {/* Explicit white background: the default transparent canvas
                produces a see-through PNG that can fail to scan on dark
                backgrounds and adds no value on a printed label. */}
            <QRCode value={payload} size={220} errorLevel="M" bgColor="#FFFFFF" />
            <div className="agri-mono" style={{ marginTop: 8 }}>
              {traceCode}
            </div>
          </div>

          <div style={{ marginTop: 16 }}>
            <InfoDescriptions
              column={1}
              items={[
                { key: "product", label: "Sản phẩm", children: lot?.product?.name ?? "—" },
                {
                  key: "lot",
                  label: "Mã lô",
                  children: <span className="agri-mono">{lot?.code ?? "—"}</span>,
                },
                {
                  key: "trace",
                  label: "Mã truy xuất",
                  children: <span className="agri-mono">{traceCode}</span>,
                },
              ]}
            />
          </div>

          <Typography.Paragraph
            className="agri-muted"
            style={{ marginTop: 12, marginBottom: 0, fontSize: 12 }}
          >
            Nội dung mã QR: <span className="agri-mono">{payload}</span>
            {isPublicUrl ? (
              <>
                {" — "}
                <a href={payload} target="_blank" rel="noreferrer" className="agri-link">
                  Mở trang truy xuất
                </a>
              </>
            ) : null}
          </Typography.Paragraph>

          {!isPublicUrl ? (
            <Alert
              style={{ marginTop: 12 }}
              type="info"
              showIcon
              title="QR đang chứa mã truy xuất dạng văn bản"
              description="Ứng dụng AgriMarket quét được mã này. Camera điện thoại thông thường sẽ hiển thị mã dạng văn bản để tra cứu thủ công."
            />
          ) : null}

          {/* Hidden high-resolution copy used only for PNG export/printing. */}
          <div
            aria-hidden
            style={{ position: "absolute", width: 0, height: 0, overflow: "hidden", opacity: 0 }}
          >
            <QRCode ref={exportRef} value={payload} size={512} errorLevel="M" bgColor="#FFFFFF" />
          </div>
        </>
      )}
    </Modal>
  );
}

/**
 * Guard used by list/detail pages before offering the QR action.
 *
 * A QR label is a SALES label — it ships on goods offered to buyers. It must
 * therefore only be offered for a lot that can still be sold: a valid trace
 * code, a status that is not REJECTED/RECALLED, and an unexpired shelf life.
 * (A PENDING_QC lot is allowed: labels are prepared while inspection is still
 * running and the lot can still become sellable.)
 */
export function canShowLotQr(
  lot: Pick<ProductLot, "traceCode" | "status" | "expiresAt"> | null | undefined,
): boolean {
  if (!lot || !isValidTraceCode(lot.traceCode)) return false;
  if (lot.status === "REJECTED" || lot.status === "RECALLED") return false;
  const expiresAt = lot.expiresAt ? new Date(lot.expiresAt) : null;
  if (expiresAt && !Number.isNaN(expiresAt.getTime()) && expiresAt.getTime() < Date.now()) {
    return false;
  }
  return true;
}


