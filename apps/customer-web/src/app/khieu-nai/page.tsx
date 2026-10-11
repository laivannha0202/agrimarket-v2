import type { Metadata } from "next";
import { ComplaintListView } from "@/components/order/ComplaintListView";
import { RequireCustomer } from "@/components/layout/RequireCustomer";

export const metadata: Metadata = {
  title: "Khiếu nại",
  description: "Gửi và theo dõi khiếu nại về đơn hàng nông sản của bạn.",
};

export default function ComplaintsPage() {
  return (
    <RequireCustomer>
      <ComplaintListView />
    </RequireCustomer>
  );
}
