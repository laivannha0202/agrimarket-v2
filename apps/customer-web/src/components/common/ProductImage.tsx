"use client";

/**
 * Product image with a clean fallback.
 *
 * The seeded catalog points at `cdn.agrimarket.vn`, which is not reachable in
 * this environment. Rather than showing a broken image, a neutral placeholder
 * with the product's first letter is rendered. Aspect ratio is fixed by the
 * parent so nothing stretches or blurs.
 */

import { Box, Center, Text } from "@mantine/core";
import { IconPhoto } from "@tabler/icons-react";
import { useState } from "react";

export function ProductImage({
  src,
  alt,
  ratio = 1,
  radius = 0,
  sizes,
  priority = false,
  fallbackLabel,
}: {
  src?: string | null;
  alt: string;
  /** width / height, e.g. 1 for square, 4/3 for landscape. */
  ratio?: number;
  radius?: number | string;
  sizes?: string;
  priority?: boolean;
  fallbackLabel?: string;
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
        background: "#f1f3f5",
      }}
    >
      {showFallback ? (
        <Center h="100%" w="100%">
          <Box ta="center">
            <IconPhoto size={26} color="#adb5bd" stroke={1.5} />
            <Text size="xs" c="dimmed" mt={4} visibleFrom="sm">
              {fallbackLabel ? fallbackLabel.slice(0, 18) : "Chưa có ảnh"}
            </Text>
          </Box>
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
