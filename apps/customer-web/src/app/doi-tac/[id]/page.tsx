import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PartnerDetail } from "@/components/partner/PartnerDetail";
import { resources } from "@/lib/api/resources";

async function loadPartner(idParam: string) {
  const id = Number(idParam);
  if (!Number.isInteger(id) || id < 1) return null;
  try {
    return await resources.getPartner(id);
  } catch {
    return null;
  }
}

export async function generateMetadata({
  params,
}: PageProps<"/doi-tac/[id]">): Promise<Metadata> {
  const { id } = await params;
  const partner = await loadPartner(id);
  return {
    title: partner?.name ?? "Đối tác",
    description: "Thông tin đối tác cung cấp nông sản và các trang trại liên kết.",
  };
}

export default async function PartnerDetailPage({ params }: PageProps<"/doi-tac/[id]">) {
  const { id } = await params;
  const numericId = Number(id);
  if (!Number.isInteger(numericId) || numericId < 1) notFound();

  return <PartnerDetail partnerId={numericId} />;
}
