import type { Metadata } from "next";
import "@mantine/core/styles.css";
import "@mantine/notifications/styles.css";
import "./globals.css";
import { Suspense } from "react";
import { ColorSchemeScript } from "@mantine/core";
import { Providers } from "./providers";
import { AppMain } from "@/components/layout/AppMain";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { MobileTabBar } from "@/components/layout/MobileTabBar";

export const metadata: Metadata = {
  title: {
    default: "AgriMarket — Nông sản sạch, rõ nguồn gốc",
    template: "%s | AgriMarket",
  },
  description:
    "Mua nông sản theo mùa từ các hợp tác xã và trang trại liên kết, truy xuất nguồn gốc đến tận lô hàng.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi" suppressHydrationWarning>
      <head>
        <ColorSchemeScript defaultColorScheme="light" />
      </head>
      <body>
        <Providers>
          <Suspense fallback={null}>
            <Header />
          </Suspense>
          <AppMain>{children}</AppMain>
          <Footer />
          <MobileTabBar />
        </Providers>
      </body>
    </html>
  );
}
