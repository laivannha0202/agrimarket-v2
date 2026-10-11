import type { Metadata } from "next";
import { ProfileView } from "@/components/account/ProfileView";
import { RequireCustomer } from "@/components/layout/RequireCustomer";

export const metadata: Metadata = {
  title: "Tài khoản của tôi",
  description: "Thông tin tài khoản khách hàng AgriMarket.",
};

export default function AccountPage() {
  return (
    <RequireCustomer>
      <ProfileView />
    </RequireCustomer>
  );
}
