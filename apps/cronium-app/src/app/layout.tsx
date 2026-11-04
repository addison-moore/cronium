import "./styles/global.css";
import type { Metadata } from "next";
import { headers } from "next/headers";
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

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Reading the request here also keeps every page out of static prerendering, which
  // is required: the production CSP allows a script only with this request's nonce,
  // and prerendered HTML has none, so the browser blocked all of a static page's
  // JavaScript. That left forgot-password, reset-password and invite activation
  // rendering forms that could not submit.
  const nonce = (await headers()).get("x-nonce") ?? undefined;

  return (
    <html suppressHydrationWarning className={inter.variable}>
      <body className={inter.className}>
        <React.Suspense fallback={null}>
          <Providers nonce={nonce}>
            <main className="min-h-screen">{children}</main>
            <Toaster />
          </Providers>
        </React.Suspense>
      </body>
    </html>
  );
}
