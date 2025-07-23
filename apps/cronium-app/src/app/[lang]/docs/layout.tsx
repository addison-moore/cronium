import type { ReactNode } from "react";
import { NextIntlClientProvider } from "next-intl";
import { getMessages } from "@/lib/get-messages";

// Define type for documentation messages
interface DocumentationMessages {
  Documentation?: {
    Title?: string;
    Description?: string;
  };
  [key: string]: DocumentationMessages | string | undefined;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ lang: string }>;
}) {
  try {
    const { lang } = await params;
    const messages = (await getMessages(lang || "en")) as DocumentationMessages;

    return {
      title: messages?.Documentation?.Title ?? "Cronium Documentation",
      description:
        messages?.Documentation?.Description ??
        "Learn how to use Cronium to automate your events and workflows",
    };
  } catch {
    return {
      title: "Cronium Documentation",
      description:
        "Learn how to use Cronium to automate your events and workflows",
    };
  }
}

export default async function DocsLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ lang: string }>;
}) {
  try {
    const { lang } = await params;
    const messages = (await getMessages(lang || "en")) as DocumentationMessages;

    return (
      <NextIntlClientProvider locale={lang || "en"} messages={messages}>
        {children}
      </NextIntlClientProvider>
    );
  } catch (error) {
    console.error("Error in DocsLayout:", error);
    // Fallback to a basic layout with no translations
    return <>{children}</>;
  }
}
