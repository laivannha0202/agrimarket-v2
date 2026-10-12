import type { Metadata } from "next";
import { VoucherListView } from "@/components/promotion/VoucherListView";

export const metadata: Metadata = {
  title: "Mã giảm giá",
  description:
    "Các chương trình giảm giá đang mở trên AgriMarket và điều kiện áp dụng của từng mã.",
};

export default function VouchersPage() {
  return <VoucherListView />;
}
