"use client";

/**
 * Product image with a clean fallback.
 *
 * Catalog photos are served by the API from `/uploads/products/` (seeded with
 * real local files). If the API is unreachable or an upload is missing, a
 * neutral leaf placeholder is rendered on the brand's soft-green surface — the
 * same placeholder the Mobile `ProductThumb` shows, never a stock photo. Aspect
 * ratio is fixed by the parent so nothing stretches or blurs.
 */

import { Box, Center } from "@mantine/core";
import { IconLeaf } from "@tabler/icons-react";
import { useState } from "react";

export function ProductImage({
  src,
  alt,
  ratio = 1,
  radius = 0,
  sizes,
  priority = false,
}: {
  src?: string | null;
  alt: string;
  /** width / height, e.g. 1 for square, 4/3 for landscape. */
  ratio?: number;
  radius?: number | string;
  sizes?: string;
  priority?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  const showFallback = !src || failed;

  return (
    <Box
      style={{
        position: "relative",
        width: "100%",
        aspectRatio: String(ratio),
        overflow: "hidden",
        borderRadius: radius,
        background: "var(--agri-primary-soft)",
      }}
    >
      {showFallback ? (
        <Center h="100%" w="100%">
          <IconLeaf size={26} stroke={1.5} color="var(--agri-primary-border)" aria-hidden />
        </Center>
      ) : (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          src={src}
          alt={alt}
          loading={priority ? "eager" : "lazy"}
          decoding="async"
          sizes={sizes}
          onError={() => setFailed(true)}
          className="agri-media"
        />
      )}
    </Box>
  );
}
