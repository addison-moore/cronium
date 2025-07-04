import "./styles/global.css";
import "@xterm/xterm/css/xterm.css";
import type { Metadata } from "next";
import React from "react";
import { Inter } from "next/font/google";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Cronium - Script Scheduler",
  description: "A powerful script scheduling and automation platform",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html suppressHydrationWarning>
      <body className={inter.className}>{children}</body>
    </html>
  );
}
