import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CheckoutSuccess } from "@/components/checkout/CheckoutSuccess";
import { RequireCustomer } from "@/components/layout/RequireCustomer";

export const metadata: Metadata = {
  title: "Đặt hàng thành công",
};

export default async function CheckoutSuccessPage({
  params,
}: PageProps<"/dat-hang-thanh-cong/[id]">) {
  const { id } = await params;
  const orderId = Number(id);
  if (!Number.isInteger(orderId) || orderId < 1) notFound();

  return (
    <RequireCustomer>
      <CheckoutSuccess orderId={orderId} />
    </RequireCustomer>
  );
}
