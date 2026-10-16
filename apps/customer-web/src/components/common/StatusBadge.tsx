"use client";

/**
 * Small badge rendering a centralised status label + tone.
 *
 * Styled as the Mobile tone pill (soft background, 1px border in the same hue).
 * `size`/`variant` are accepted for backwards compatibility but the pill look
 * is fixed so every status reads the same across the app.
 */

import { ToneBadge } from "@/components/ui/kit";
import type { Tone } from "@/lib/status";

export function StatusBadge({
  label,
  tone,
}: {
  label: string;
  tone: Tone;
  size?: string;
  variant?: "light" | "filled" | "outline";
}) {
  return <ToneBadge tone={tone}>{label}</ToneBadge>;
}
