import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { OrderDetail } from "@/components/order/OrderDetail";
import { RequireCustomer } from "@/components/layout/RequireCustomer";

export const metadata: Metadata = {
  title: "Chi tiết đơn hàng",
  description: "Theo dõi trạng thái đơn hàng, kiện hàng và vận chuyển trên AgriMarket.",
};

export default async function OrderDetailPage({ params }: PageProps<"/don-hang/[id]">) {
  const { id } = await params;
  const orderId = Number(id);
  if (!Number.isInteger(orderId) || orderId < 1) notFound();

  return (
    <RequireCustomer>
      <OrderDetail orderId={orderId} />
    </RequireCustomer>
  );
}
