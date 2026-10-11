import type { Metadata } from "next";
import { AddressListView } from "@/components/account/AddressListView";
import { RequireCustomer } from "@/components/layout/RequireCustomer";

export const metadata: Metadata = {
  title: "Sổ địa chỉ",
  description: "Quản lý địa chỉ giao hàng của bạn trên AgriMarket.",
};

export default function AddressesPage() {
  return (
    <RequireCustomer>
      <AddressListView />
    </RequireCustomer>
  );
}
