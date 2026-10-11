import type { Metadata } from "next";
import { CheckoutView } from "@/components/checkout/CheckoutView";
import { RequireCustomer } from "@/components/layout/RequireCustomer";

export const metadata: Metadata = {
  title: "Thanh toán",
  description: "Xác nhận địa chỉ giao hàng và đặt hàng.",
};

export default function CheckoutPage() {
  return (
    <RequireCustomer>
      <CheckoutView />
    </RequireCustomer>
  );
}
