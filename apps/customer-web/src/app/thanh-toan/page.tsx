import type { Metadata } from "next";
import { CheckoutView } from "@/components/checkout/CheckoutView";
import { RequireCustomer } from "@/components/layout/RequireCustomer";

export const metadata: Metadata = {
  title: "Thanh toán",
  description: "Xác nhận địa chỉ giao hàng và đặt hàng.",
};

/**
 * `mua-ngay=<variantId>:<quantity>` — "Mua ngay" (buy now). The line is parsed
 * on the client by the shared checkout helper; the page only forwards the raw
 * value, so a malformed parameter produces an explicit error state instead of
 * a silent cart checkout. Reading `searchParams` makes the route dynamic, which
 * this page already is: everything it shows depends on the customer's session.
 */
export default async function CheckoutPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const rawBuyNow = params["mua-ngay"];
  const buyNow = Array.isArray(rawBuyNow) ? rawBuyNow[0] : rawBuyNow;

  return (
    <RequireCustomer>
      <CheckoutView buyNowRaw={buyNow} />
    </RequireCustomer>
  );
}
