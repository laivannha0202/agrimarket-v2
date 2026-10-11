import type { Metadata } from "next";
import { ReturnDetail } from "@/components/order/ReturnDetail";
import { RequireCustomer } from "@/components/layout/RequireCustomer";

export const metadata: Metadata = {
  title: "Chi tiết yêu cầu trả hàng",
  description: "Theo dõi yêu cầu trả hàng đã gửi tới AgriMarket.",
};

export default async function ReturnDetailPage({ params }: PageProps<"/tra-hang/[id]">) {
  const { id } = await params;
  const returnId = Number(id);

  return (
    <RequireCustomer>
      <ReturnDetail returnId={Number.isInteger(returnId) && returnId > 0 ? returnId : null} />
    </RequireCustomer>
  );
}
