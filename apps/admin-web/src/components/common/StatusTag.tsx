import { Tag } from "antd";
import type { StatusColor, StatusDescriptor } from "@/lib/status";

const COLOR_MAP: Record<StatusColor, string | undefined> = {
  default: undefined,
  processing: "blue",
  success: "green",
  warning: "orange",
  error: "red",
};

export function StatusTag({ status }: { status: StatusDescriptor }) {
  const color = COLOR_MAP[status.color];
  return (
    <Tag color={color} style={{ marginInlineEnd: 0 }}>
      {status.label}
    </Tag>
  );
}
