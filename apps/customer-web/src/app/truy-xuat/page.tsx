import type { Metadata } from "next";
import { TraceLookup } from "@/components/trace/TraceLookup";

export const metadata: Metadata = {
  title: "Truy xuất nguồn gốc",
  description:
    "Nhập mã truy xuất để xem vụ mùa, trang trại, kết quả kiểm định và chứng nhận của lô hàng.",
};

export default function TracePage() {
  return <TraceLookup />;
}
