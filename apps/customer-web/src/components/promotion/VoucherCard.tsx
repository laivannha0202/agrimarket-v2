"use client";

/** Public voucher details. Actual savings and redemption are checked at checkout. */

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { formatDate, formatNumber } from "@/lib/format";
import { voucherStatus } from "@/lib/vouchers";
import { useNow } from "@/lib/hooks/useNow";
import { IconCalendar, IconCart, IconChevron, IconCopy } from "./voucher-icons";
import styles from "./voucher.module.css";
import type { Voucher } from "@/lib/api/types";

/** Page-level toast sink; the list view owns the single toast element. */
export type VoucherToast = (message: string) => void;

export function VoucherCard({
  voucher,
  onToast,
}: {
  voucher: Voucher;
  onToast?: VoucherToast;
}) {
  const now = useNow();
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const resetTimer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (resetTimer.current !== null) window.clearTimeout(resetTimer.current);
    },
    [],
  );

  const status = voucherStatus(voucher, now);
  const statusClass =
    status.tone === "success"
      ? styles.status
      : status.tone === "warning"
        ? `${styles.status} ${styles.statusWarning}`
        : status.tone === "danger"
          ? `${styles.status} ${styles.statusDanger}`
          : status.tone === "neutral"
            ? `${styles.status} ${styles.statusNeutral}`
            : styles.status;

  const isPercent = voucher.discountType === "PERCENT";
  const rawValue = Number(voucher.discountValue);
  const minSpend = Number(voucher.minOrderAmount);
  const amountText = Number.isFinite(rawValue) ? formatNumber(rawValue) : "—";
  const amountBySpoken = Number.isFinite(rawValue)
    ? isPercent
      ? `Giảm ${rawValue} phần trăm`
      : `Giảm ${formatNumber(rawValue)} đồng`
    : null;
  const valueAria = [
    amountBySpoken,
    minSpend > 0 ? `đơn hàng từ ${formatNumber(minSpend)} đồng` : null,
  ]
    .filter(Boolean)
    .join(", ");
  const amountLong = amountText.length > 7;

  const maxDiscount =
    voucher.maxDiscount === null ? null : Number(voucher.maxDiscount);
  const maxText = isPercent
    ? maxDiscount !== null && Number.isFinite(maxDiscount) && maxDiscount > 0
      ? `${formatNumber(maxDiscount)}đ`
      : null
    : amountText === "—"
      ? null
      : `${amountText}đ`;
  const remaining =
    voucher.usageLimit === null
      ? null
      : Math.max(0, voucher.usageLimit - voucher.usedCount);

  const panelId = `voucher-${voucher.id}-conditions`;

  const copyCode = async () => {
    try {
      await copyText(voucher.code);
    } catch {
      onToast?.("Không thể sao chép tự động. Hãy chọn và sao chép mã thủ công.");
      return;
    }
    setCopied(true);
    if (resetTimer.current !== null) window.clearTimeout(resetTimer.current);
    resetTimer.current = window.setTimeout(() => setCopied(false), 2200);
    onToast?.(`Đã sao chép mã ${voucher.code}`);
  };

  return (
    <article className={styles.voucherCard}>
      <div className={styles.voucherValue} aria-label={valueAria || undefined}>
        <div className={styles.voucherEyebrow}>Giảm</div>
        <div
          className={[
            styles.voucherAmount,
            amountLong ? styles.voucherAmountLong : "",
          ]
            .filter(Boolean)
            .join(" ")}
        >
          <strong>{amountText}</strong>
          <span>{isPercent ? "%" : "đ"}</span>
        </div>
      </div>
      <div className={styles.voucherDetail}>
        <div className={styles.detailHead}>
          <h2 className={styles.detailTitle}>{voucher.name}</h2>
          <span className={statusClass}>{status.label}</span>
        </div>
        <div className={styles.detailsMeta}>
          {minSpend > 0 ? (
            <span>Đơn tối thiểu <strong>{formatNumber(minSpend)}đ</strong></span>
          ) : null}
          <span className={styles.validity}>
            <IconCalendar className={styles.icon} aria-hidden="true" />
            {status.phase === "upcoming" ? "Bắt đầu" : "Hạn dùng"}{" "}
            <strong>
              {formatDate(
                status.phase === "upcoming" ? voucher.startsAt : voucher.endsAt,
              )}
            </strong>
          </span>
        </div>
        <div className={styles.codeRow}>
          <div className={styles.codeMeta}>
            <span className={styles.codeLabel}>Mã ưu đãi</span>
            <span className={styles.voucherCode}>{voucher.code}</span>
          </div>
          <button
            type="button"
            className={`${styles.copyBtn}${copied ? ` ${styles.copied}` : ""}`}
            onClick={copyCode}
            aria-label={
              copied ? `Đã sao chép mã ${voucher.code}` : `Sao chép mã ${voucher.code}`
            }
          >
            <IconCopy className={styles.icon} aria-hidden="true" />
            <span>{copied ? "Đã sao chép" : "Sao chép"}</span>
          </button>
        </div>
        <div className={styles.detailActions}>
          <button
            type="button"
            className={styles.conditionsToggle}
            onClick={() => setExpanded((value) => !value)}
            aria-expanded={expanded}
            aria-controls={panelId}
          >
            Xem điều kiện
            <IconChevron className={styles.icon} aria-hidden="true" />
          </button>
          <Link href="/san-pham" className={styles.shopBtn}>
            <IconCart className={styles.icon} aria-hidden="true" />
            Mua sắm ngay
          </Link>
        </div>
        <div className={styles.conditionsPanel} id={panelId} hidden={!expanded}>
          <ul>
            {minSpend > 0 ? (
              <li>
                Đơn hàng tối thiểu <strong>{formatNumber(minSpend)}đ</strong>.
              </li>
            ) : null}
            {maxText !== null ? (
              <li>Giảm tối đa <strong>{maxText}</strong>.</li>
            ) : null}
            {remaining !== null && voucher.usageLimit !== null ? (
              <li>
                Còn lại{" "}
                <strong>
                  {formatNumber(remaining)}/{formatNumber(voucher.usageLimit)}{" "}
                  lượt
                </strong>
                .
              </li>
            ) : null}
            {voucher.perCustomerLimit !== null ? (
              <li>
                Mỗi khách hàng tối đa{" "}
                <strong>{voucher.perCustomerLimit} lần</strong>.
              </li>
            ) : null}
            <li>
              Hạn sử dụng đến <strong>{formatDate(voucher.endsAt)}</strong>.
            </li>
            <li>
              Hệ thống kiểm tra điều kiện và xác nhận số tiền được giảm tại bước
              thanh toán.
            </li>
          </ul>
        </div>
      </div>
    </article>
  );
}

/** Clipboard API with the existing HTTP/LAN fallback. */
async function copyText(value: string): Promise<void> {
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const temporary = document.createElement("textarea");
  temporary.value = value;
  temporary.setAttribute("readonly", "");
  temporary.style.position = "fixed";
  temporary.style.opacity = "0";
  document.body.appendChild(temporary);
  temporary.select();
  const worked = document.execCommand("copy");
  temporary.remove();
  if (!worked) throw new Error("Copy failed");
}
