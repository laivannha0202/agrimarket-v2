"use client";

/**
 * Hero banner.
 *
 * The Mobile home hero: the brand illustration (`hero_nong_san_no_text`) with
 * static BRAND copy on top. The backend has no banner-management API, so this
 * is deliberately brand content only — no product, price or promotion is
 * fabricated here; those all come from the API in the sections below.
 */

import { Box, Button, Container, Image, Text } from "@mantine/core";
import { IconArrowRight } from "@tabler/icons-react";
import Link from "next/link";
import { layout } from "@/theme";

export function Hero() {
  return (
    <Box pt={{ base: 12, sm: 20 }}>
      <Container size={layout.containerSize} px={{ base: 12, sm: "lg" }}>
        <Box
          mih={{ base: 158, sm: 200 }}
          style={{
            position: "relative",
            borderRadius: 16,
            overflow: "hidden",
            border: "1px solid var(--agri-border)",
            background: "var(--agri-primary-soft)",
          }}
        >
          <Image
            src="/design/home/hero_nong_san_no_text_1200x480.png"
            alt=""
            aria-hidden
            style={{
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
              objectFit: "cover",
            }}
          />
          <Box
            style={{ position: "relative", padding: "20px 18px", maxWidth: 360 }}
          >
            <Text
              fz={{ base: 23, sm: 28 }}
              fw={700}
              c="#095c2c"
              lh={1.22}
              style={{ textShadow: "0 1px 1px rgba(255,255,255,0.5)" }}
            >
              Nông sản sạch
            </Text>
            <Text
              fz={{ base: 23, sm: 28 }}
              fw={700}
              c="#095c2c"
              lh={1.22}
              style={{ textShadow: "0 1px 1px rgba(255,255,255,0.5)" }}
            >
              Từ nông trại Việt
            </Text>
            <Button
              component={Link}
              href="/san-pham"
              mt={14}
              radius={999}
              size="sm"
              rightSection={<IconArrowRight size={16} />}
            >
              Khám phá ngay
            </Button>
          </Box>
        </Box>
      </Container>
    </Box>
  );
}
