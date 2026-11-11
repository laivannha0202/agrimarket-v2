"use client";

/** Public voucher catalogue. The checkout flow validates the selected code. */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Button, Skeleton } from "@mantine/core";
import { IconTicket, IconTicketOff } from "@tabler/icons-react";
import { resources } from "@/lib/api/resources";
import { queryKeys } from "@/lib/api/query-keys";
import { useNow } from "@/lib/hooks/useNow";
import { EmptyState, ErrorState } from "@/components/common/States";
import { VoucherCard } from "@/components/promotion/VoucherCard";
import { IconArrow } from "@/components/promotion/voucher-icons";
import { splitVouchers, voucherStatus } from "@/lib/vouchers";
import type { Voucher } from "@/lib/api/types";
import type { VoucherStatus } from "@/lib/vouchers";
import styles from "./voucher.module.css";

interface VoucherOption {
  voucher: Voucher;
  status: VoucherStatus;
}

export function VoucherListView() {
  const now = useNow();

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: queryKeys.vouchers.list(50),
    queryFn: () => resources.listVouchers(50),
    staleTime: 60_000,
  });

  const vouchers = useMemo<Voucher[]>(() => data?.data ?? [], [data]);

  const options = useMemo<VoucherOption[]>(() => {
    // No catalog order in view: the minimum-order rule is a property of a
    // specific order, so only the period/quota rules reorder the list —
    // usable codes first, then the rest.
    const { eligible, ineligible } = splitVouchers(vouchers, null, {
      now: now === 0 ? undefined : now,
    });
    return [...eligible, ...ineligible].map((option) => ({
      voucher: option.voucher,
      status: voucherStatus(option.voucher, now),
    }));
  }, [vouchers, now]);

  const ongoingCount = useMemo(
    () => options.filter((option) => option.status.running).length,
    [options],
  );

  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const toastTimer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
    },
    [],
  );

  const showToast = useCallback((message: string) => {
    setToastMessage(message);
    if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToastMessage(null), 2500);
  }, []);

  const multiple = options.length > 1;

  return (
    <div className={styles.page}>
      <nav className={styles.crumbs} aria-label="Breadcrumb">
        <Link href="/">Trang chủ</Link>
        <span className={styles.sep}>/</span>
        <span aria-current="page">Mã giảm giá</span>
      </nav>

      <section className={styles.intro} aria-labelledby="page-title">
        <div className={styles.introText}>
          <h1 id="page-title" className={styles.introTitle}>
            Mã giảm giá
          </h1>
          <p className={styles.introDesc}>
            Chọn ưu đãi phù hợp, sao chép mã và tiết kiệm khi mua nông sản.
          </p>
        </div>
        {options.length > 0 ? (
          <span className={styles.count}>
            <span className={styles.countDot} aria-hidden="true" />
            {ongoingCount} ưu đãi đang diễn ra
          </span>
        ) : null}
      </section>

      {isError ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : isLoading ? (
        <VoucherListSkeleton />
      ) : options.length === 0 ? (
        <EmptyState
          icon={<IconTicketOff size={28} />}
          title="Ưu đãi đang được làm mới"
          description="Hiện chưa có mã giảm giá nào đang mở. Bạn vẫn có thể khám phá nông sản và quay lại khi có ưu đãi mới."
          action={
            <Button
              component={Link}
              href="/san-pham"
              radius={10}
              leftSection={<IconTicket size={16} />}
              styles={{
                root: { minHeight: 44, paddingInline: 17 },
                label: { fontSize: 14, fontWeight: 700 },
              }}
            >
              Khám phá sản phẩm
            </Button>
          }
        />
      ) : (
        <section
          className={`${styles.voucherList}${multiple ? ` ${styles.multiple}` : ""}`}
          aria-label="Danh sách mã giảm giá"
        >
          {options.map((option) => (
            <VoucherCard
              key={option.voucher.id}
              voucher={option.voucher}
              onToast={showToast}
            />
          ))}
        </section>
      )}

      {options.length > 0 ? (
        <>
          <section className={styles.howto} aria-labelledby="howto-title">
            <h2 className={styles.howtoHeading} id="howto-title">
              Cách sử dụng mã giảm giá
            </h2>
            <div className={styles.steps}>
              <div className={styles.step}>
                <span className={styles.stepNum}>1</span>
                <span>
                  <b>Sao chép mã</b> ưu đãi
                </span>
              </div>
              <IconArrow className={styles.stepArrow} aria-hidden="true" />
              <div className={styles.step}>
                <span className={styles.stepNum}>2</span>
                <span>
                  <b>Chọn sản phẩm</b> yêu thích
                </span>
              </div>
              <IconArrow className={styles.stepArrow} aria-hidden="true" />
              <div className={styles.step}>
                <span className={styles.stepNum}>3</span>
                <span>
                  <b>Nhập mã</b> khi thanh toán
                </span>
              </div>
            </div>
          </section>
          <p className={styles.pageNote}>
            Mã được công khai để xem và sao chép. Việc sử dụng mã phụ thuộc vào
            điều kiện thực tế của đơn hàng.
          </p>
        </>
      ) : null}

      <div
        className={`${styles.toast}${toastMessage ? ` ${styles.toastShow}` : ""}`}
        role="status"
        aria-live="polite"
      >
        {toastMessage}
      </div>
    </div>
  );
}

/** Loading placeholder with the same proportions as the voucher card. */
function VoucherListSkeleton() {
  return (
    <section
      className={styles.voucherList}
      aria-label="Danh sách mã giảm giá"
      aria-busy="true"
    >
      <div className={`${styles.voucherCard} ${styles.skeletonCard}`} aria-hidden="true">
        <div className={styles.railSkeleton} />
        <div className={styles.voucherDetail}>
          <Skeleton height={22} width="62%" radius="sm" />
          <Skeleton height={14} width="40%" radius="sm" mt={9} mb={19} />
          <Skeleton height={64} radius={12} />
          <Skeleton height={40} radius={10} mt={16} />
        </div>
      </div>
    </section>
  );
}
