import type { Metadata } from "next";
import { ComplaintDetail } from "@/components/order/ComplaintDetail";
import { RequireCustomer } from "@/components/layout/RequireCustomer";

export const metadata: Metadata = {
  title: "Chi tiết khiếu nại",
  description: "Theo dõi khiếu nại đã gửi tới AgriMarket.",
};

export default async function ComplaintDetailPage({ params }: PageProps<"/khieu-nai/[id]">) {
  const { id } = await params;
  const complaintId = Number(id);

  return (
    <RequireCustomer>
      <ComplaintDetail
        complaintId={Number.isInteger(complaintId) && complaintId > 0 ? complaintId : null}
      />
    </RequireCustomer>
  );
}
