import { ReactNode } from 'react';
import { NextIntlClientProvider } from 'next-intl';
import { getMessages } from '@/lib/get-messages';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ lang: string }>;
}) {
  try {
    const { lang } = await params;
    const messages = await getMessages(lang || 'en');
    
    return {
      title: messages?.Documentation?.Title || 'Cronium Documentation',
      description: messages?.Documentation?.Description || 'Learn how to use Cronium to automate your events and workflows',
    };
  } catch (error) {
    console.error('Error generating metadata:', error);
    return {
      title: 'Cronium Documentation',
      description: 'Learn how to use Cronium to automate your events and workflows',
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
    const messages = await getMessages(lang || 'en');

    return (
      <NextIntlClientProvider locale={lang || 'en'} messages={messages}>
        {children}
      </NextIntlClientProvider>
    );
  } catch (error) {
    console.error('Error in DocsLayout:', error);
    // Fallback to a basic layout with no translations
    return <>{children}</>;
  }
}