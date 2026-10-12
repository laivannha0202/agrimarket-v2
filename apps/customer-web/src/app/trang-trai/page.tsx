import type { Metadata } from "next";
import { FarmListView } from "@/components/farm/FarmListView";

export const metadata: Metadata = {
  title: "Trang trại",
  description:
    "Các trang trại liên kết đang cung cấp nông sản cho AgriMarket, kèm vùng trồng và diện tích.",
};

export default function FarmsPage() {
  return <FarmListView />;
}
