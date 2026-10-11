import type { Metadata } from "next";
import { OrderListView } from "@/components/order/OrderListView";
import { RequireCustomer } from "@/components/layout/RequireCustomer";

export const metadata: Metadata = {
  title: "Đơn hàng của tôi",
  description: "Theo dõi trạng thái đơn hàng và nguồn gốc lô hàng đã mua.",
};

export default function OrdersPage() {
  return (
    <RequireCustomer>
      <OrderListView />
    </RequireCustomer>
  );
}
