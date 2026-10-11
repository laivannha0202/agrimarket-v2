import type { Metadata } from "next";
import { ReturnListView } from "@/components/order/ReturnListView";
import { RequireCustomer } from "@/components/layout/RequireCustomer";

export const metadata: Metadata = {
  title: "Trả hàng",
  description: "Gửi yêu cầu trả hàng cho sản phẩm trong đơn hàng đã giao.",
};

export default function ReturnsPage() {
  return (
    <RequireCustomer>
      <ReturnListView />
    </RequireCustomer>
  );
}
