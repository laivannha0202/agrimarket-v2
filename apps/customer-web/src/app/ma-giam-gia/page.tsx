import type { Metadata } from "next";
import { VoucherListView } from "@/components/promotion/VoucherListView";

export const metadata: Metadata = {
  title: "Mã giảm giá",
  description:
    "Chọn ưu đãi phù hợp, sao chép mã và tiết kiệm khi mua nông sản.",
};

export default function VouchersPage() {
  return <VoucherListView />;
}
