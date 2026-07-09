import React from "react";
import { type Metadata } from "next";
import { ThemeProvider } from "@/components/theme-provider";
import { GoogleAnalytics } from "@/components/analytics";
import {
  SITE_URL,
  SITE_NAME,
  SITE_TITLE,
  SITE_DESCRIPTION,
  SITE_KEYWORDS,
  GITHUB_URL,
} from "@/lib/site";
import "./styles/global.css";

export const metadata: Metadata = {
  // Makes every relative canonical/OG URL resolve to an absolute one.
  metadataBase: new URL(SITE_URL),
  title: {
    default: SITE_TITLE,
    // Per-page titles render as "Quick Start | Cronium"
    template: `%s | ${SITE_NAME}`,
  },
  description: SITE_DESCRIPTION,
  keywords: SITE_KEYWORDS,
  applicationName: SITE_NAME,
  authors: [{ name: "Addison Moore", url: GITHUB_URL }],
  creator: "Addison Moore",
  publisher: SITE_NAME,
  alternates: {
    canonical: "/",
  },
  // NOTE: og:image / twitter:image are supplied automatically by the
  // app/opengraph-image.tsx file convention (generated at build time), so no
  // static asset needs to exist.
  openGraph: {
    type: "website",
    siteName: SITE_NAME,
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    url: SITE_URL,
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
  icons: {
    icon: "/favicon.ico",
    shortcut: "/favicon.ico",
    apple: "/assets/logo-icon.png",
  },
  category: "technology",
};

/**
 * Structured data. SoftwareApplication is what makes Google understand this is
 * a product (and can surface a rich result); WebSite enables sitelinks search.
 */
function StructuredData() {
  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "SoftwareApplication",
        "@id": `${SITE_URL}/#software`,
        name: SITE_NAME,
        description: SITE_DESCRIPTION,
        url: SITE_URL,
        applicationCategory: "DeveloperApplication",
        applicationSubCategory: "Automation Platform",
        operatingSystem: "Linux, macOS, Windows (Docker)",
        softwareHelp: `${SITE_URL}/docs`,
        license: "https://www.gnu.org/licenses/agpl-3.0.html",
        isAccessibleForFree: true,
        offers: {
          "@type": "Offer",
          price: "0",
          priceCurrency: "USD",
        },
        featureList: [
          "Scheduled script execution (Python, Node.js, Bash)",
          "Visual multi-step workflow builder",
          "Remote execution over SSH",
          "Containerized, isolated execution",
          "Real-time execution logs",
          "Integrations: Slack, Discord, Microsoft Teams, Notion, Trello, Email, Google Sheets",
        ],
        codeRepository: GITHUB_URL,
      },
      {
        "@type": "WebSite",
        "@id": `${SITE_URL}/#website`,
        url: SITE_URL,
        name: SITE_NAME,
        description: SITE_DESCRIPTION,
        publisher: { "@id": `${SITE_URL}/#organization` },
      },
      {
        "@type": "Organization",
        "@id": `${SITE_URL}/#organization`,
        name: SITE_NAME,
        url: SITE_URL,
        logo: `${SITE_URL}/assets/logo-icon.svg`,
        sameAs: [GITHUB_URL],
      },
    ],
  };

  return (
    <script
      type="application/ld+json"
      // Structured data must be inlined; content is static and trusted.
      dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
    />
  );
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="h-full" suppressHydrationWarning>
      <head>
        <StructuredData />
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
        <GoogleAnalytics />
      </body>
    </html>
  );
}
