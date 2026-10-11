import type { Metadata } from "next";
import { CartView } from "@/components/cart/CartView";
import { RequireCustomer } from "@/components/layout/RequireCustomer";

export const metadata: Metadata = {
  title: "Giỏ hàng",
  description: "Giỏ hàng nông sản của bạn trên AgriMarket.",
};

export default function CartPage() {
  return (
    <RequireCustomer title="Vui lòng đăng nhập để xem giỏ hàng">
      <CartView />
    </RequireCustomer>
  );
}
