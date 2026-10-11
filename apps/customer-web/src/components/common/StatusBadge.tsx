"use client";

/** Small badge rendering a centralised status label + tone. */

import { Badge } from "@mantine/core";
import type { Tone } from "@/lib/status";

const TONE_COLOR: Record<Tone, string> = {
  green: "agri",
  blue: "blue",
  yellow: "yellow",
  orange: "orange",
  red: "red",
  gray: "gray",
};

export function StatusBadge({
  label,
  tone,
  size = "sm",
  variant = "light",
}: {
  label: string;
  tone: Tone;
  size?: string;
  variant?: "light" | "filled" | "outline";
}) {
  return (
    <Badge color={TONE_COLOR[tone]} variant={variant} size={size} radius="sm">
      {label}
    </Badge>
  );
}
