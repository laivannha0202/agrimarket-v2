import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { FarmDetail } from "@/components/farm/FarmDetail";
import { resources } from "@/lib/api/resources";

async function loadFarm(idParam: string) {
  const id = Number(idParam);
  if (!Number.isInteger(id) || id < 1) return null;
  try {
    return await resources.getFarm(id);
  } catch {
    return null;
  }
}

export async function generateMetadata({
  params,
}: PageProps<"/trang-trai/[id]">): Promise<Metadata> {
  const { id } = await params;
  const farm = await loadFarm(id);
  return {
    title: farm?.name ?? "Trang trại",
    description:
      farm?.description ??
      "Thông tin trang trại, vùng trồng và chứng nhận còn hiệu lực trên AgriMarket.",
  };
}

export default async function FarmDetailPage({ params }: PageProps<"/trang-trai/[id]">) {
  const { id } = await params;
  const numericId = Number(id);
  if (!Number.isInteger(numericId) || numericId < 1) notFound();

  return <FarmDetail farmId={numericId} />;
}
