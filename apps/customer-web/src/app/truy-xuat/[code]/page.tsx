import type { Metadata } from "next";
import { TraceDetail } from "@/components/trace/TraceDetail";

export const metadata: Metadata = {
  title: "Chi tiết truy xuất",
  description: "Hành trình của lô nông sản từ thu hoạch đến kho.",
};

export default async function TraceDetailPage({ params }: PageProps<"/truy-xuat/[code]">) {
  const { code } = await params;
  return <TraceDetail traceCode={decodeURIComponent(code)} />;
}
