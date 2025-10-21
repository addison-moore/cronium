import React from "react";
import { type Metadata } from "next";
import { ThemeProvider } from "@/components/theme-provider";
import "./styles/global.css";

export const metadata: Metadata = {
  title: "Cronium - Self-Hosted Automation Platform",
  description:
    "Open-source automation platform designed for developers and teams who need reliable, flexible task scheduling and workflow automation.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="h-full" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              // Apply dark mode based on system preference
              try {
                if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
                  document.documentElement.classList.add('dark');
                }
              } catch (e) {}
            `,
          }}
        />
      </head>
      <body className="bg-background h-full text-gray-900 dark:text-gray-100">
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
