import "./styles/global.css";
import type { Metadata } from "next";
import React from "react";
import { Inter } from "next/font/google";
import { Providers } from "@/components/providers/Providers";
import { Toaster } from "@cronium/ui";

export const runtime = "nodejs";

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter",
});

export const metadata: Metadata = {
  title: "Cronium - Script Scheduler",
  description: "A powerful script scheduling and automation platform",
  icons: {
    icon: "/assets/logo-icon.svg",
    apple: "/assets/logo-icon.png",
  },
  manifest: "/manifest.json",
  other: {
    preconnect: ["https://fonts.googleapis.com", "https://fonts.gstatic.com"],
    "dns-prefetch": [
      "https://fonts.googleapis.com",
      "https://fonts.gstatic.com",
    ],
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html suppressHydrationWarning>
      <body className={inter.className}>
        <React.Suspense fallback={null}>
          <Providers>
            <main className="min-h-screen">{children}</main>
            <Toaster />
          </Providers>
        </React.Suspense>
      </body>
    </html>
  );
}
