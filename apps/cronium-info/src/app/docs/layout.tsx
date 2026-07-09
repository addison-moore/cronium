import type { ReactNode } from "react";
import type { Metadata } from "next";
import { SITE_NAME } from "@/lib/site";

/**
 * Only supplies a fallback for the docs section. Individual docs pages export
 * their own `metadata` (unique title + description + canonical), which is what
 * search engines index — a single shared title across every docs page hurts
 * discoverability.
 */
export const metadata: Metadata = {
  title: {
    default: `Documentation | ${SITE_NAME}`,
    template: `%s | ${SITE_NAME} Docs`,
  },
  description:
    "Documentation for Cronium — how to self-host, schedule scripts, build workflows, connect servers, and use the API.",
};

export default function DocsLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
