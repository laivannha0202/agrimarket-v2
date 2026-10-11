"use client";

/**
 * Evidence photo gallery for a complaint, return request or review.
 *
 * WHY THE URL IS BUILT HERE
 *
 * The API returns image ids, never URLs: the files are private and served by
 * `GET /evidence/:id/file`, which authorises the caller. So the browser must
 * send its token to render one — a plain `<img src>` would arrive anonymous and
 * be refused for everything except an approved review.
 *
 * That is what `useEvidenceImages` does: it fetches each image as a blob with
 * the session attached and hands back an object URL, which is then revoked when
 * the component unmounts (or the ids change) so a long session cannot leak
 * memory one thumbnail at a time.
 *
 * A photo that fails to load renders a neutral placeholder rather than a broken
 * icon: a missing file is a real possibility and should not look like a bug in
 * the customer's own upload.
 */

import { Box, Group, Image, SimpleGrid, Text } from "@mantine/core";
import { IconPhotoOff } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import { fetchEvidenceBlobUrl } from "@/lib/api/resources";
import type { EvidenceImage } from "@/lib/api/types";

/**
 * Loads every image and returns a map of id → object URL.
 *
 * The effect is keyed on the joined ids, so adding or removing a photo reloads
 * only what changed, and every URL created here is revoked in the cleanup.
 *
 * With no ids there is nothing to load, so the effect does nothing and the
 * caller gets an empty map — the previous code cleared the map with a
 * `setState` inside the effect body, which React flags as a cascading render.
 */
export function useEvidenceImages(images: EvidenceImage[] | undefined): Record<number, string> {
  const [urls, setUrls] = useState<Record<number, string>>({});
  const key = (images ?? []).map((i) => i.id).join(",");

  useEffect(() => {
    if (!key) return;
    const ids = key.split(",").map(Number);

    let cancelled = false;
    const created: string[] = [];

    void (async () => {
      const next: Record<number, string> = {};
      for (const id of ids) {
        const url = await fetchEvidenceBlobUrl(id);
        if (!url) continue;
        next[id] = url;
        created.push(url);
      }
      // A late response after unmount would otherwise set state on a dead
      // component and leak the URLs it created.
      if (cancelled) {
        created.forEach((u) => URL.revokeObjectURL(u));
        return;
      }
      setUrls(next);
    })();

    return () => {
      cancelled = true;
      created.forEach((u) => URL.revokeObjectURL(u));
    };
  }, [key]);

  // The map only ever describes the current ids, so with none there is nothing
  // to show and a stale map must not leak through.
  return key ? urls : {};
}

export interface EvidenceGalleryProps {
  images: EvidenceImage[] | undefined;
  label?: string;
}

export function EvidenceGallery({ images, label = "Ảnh minh chứng" }: EvidenceGalleryProps) {
  const urls = useEvidenceImages(images);
  if (!images || images.length === 0) return null;

  return (
    <Box>
      <Text size="sm" c="dimmed" mb={6}>
        {label} ({images.length})
      </Text>
      <SimpleGrid cols={{ base: 3, sm: 4 }} spacing="sm">
        {images.map((img) => {
          const url = urls[img.id];
          return (
            <Box
              key={img.id}
              style={{
                aspectRatio: "1 / 1",
                borderRadius: 8,
                overflow: "hidden",
                border: "1px solid var(--mantine-color-gray-3)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: "var(--mantine-color-gray-0)",
              }}
            >
              {url ? (
                <Image src={url} alt="Ảnh minh chứng" fit="cover" w="100%" h="100%" />
              ) : (
                <Group gap={4} wrap="nowrap">
                  <IconPhotoOff size={16} color="var(--mantine-color-gray-5)" />
                </Group>
              )}
            </Box>
          );
        })}
      </SimpleGrid>
    </Box>
  );
}
