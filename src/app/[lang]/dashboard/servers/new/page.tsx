'use client';

import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import ServerForm from '@/components/dashboard/ServerForm';

export default function NewServerPage() {
  const router = useRouter();
  const params = useParams();
  const lang = params.lang as string;
  const t = useTranslations('Servers');
  
  const handleSuccess = (serverId?: number) => {
    if (serverId) {
      router.push(`/${lang}/dashboard/servers/${serverId}`);
    } else {
      router.push(`/${lang}/dashboard/servers`);
    }
  };
  
  return (
    <div className="container mx-auto p-4">
      <div className="flex items-center mb-6">
        <Button
          variant="ghost"
          size="sm"
          className="mr-2"
          asChild
        >
          <Link href={`/${lang}/dashboard/servers`}>
            <ArrowLeft className="h-4 w-4 mr-1" />
            {t('BackToServers')}
          </Link>
        </Button>
        <h1 className="text-2xl font-bold">{t('AddNewServer')}</h1>
      </div>
      
      <div className="max-w-4xl mx-auto bg-card rounded-lg border border-input p-6">
        <ServerForm
          isEditing={false}
          onSuccess={handleSuccess}
          lang={lang}
        />
      </div>
    </div>
  );
}