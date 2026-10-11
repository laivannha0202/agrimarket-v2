import type { Metadata } from "next";
import { ReviewListView } from "@/components/order/ReviewListView";
import { RequireCustomer } from "@/components/layout/RequireCustomer";

export const metadata: Metadata = {
  title: "Đánh giá sản phẩm",
  description: "Đánh giá nông sản bạn đã mua trên AgriMarket.",
};

export default function ReviewsPage() {
  return (
    <RequireCustomer>
      <ReviewListView />
    </RequireCustomer>
  );
}
