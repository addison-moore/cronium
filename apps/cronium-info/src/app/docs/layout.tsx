import type { ReactNode } from "react";

export function generateMetadata() {
  return {
    title: "Cronium Documentation",
    description:
      "Learn how to use Cronium to automate your events and workflows",
  };
}

export default function DocsLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
