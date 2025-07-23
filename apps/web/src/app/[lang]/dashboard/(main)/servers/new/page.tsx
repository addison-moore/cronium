"use client";

import { useRouter, useParams } from "next/navigation";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import ServerForm from "@/components/dashboard/ServerForm";

export default function NewServerPage() {
  const router = useRouter();
  const params = useParams();
  const lang = params.lang as string;
  const t = useTranslations("Servers");

  const handleSuccess = (serverId?: number) => {
    if (serverId) {
      router.push(`/${lang}/dashboard/servers/${serverId}`);
    } else {
      router.push(`/${lang}/dashboard/servers`);
    }
  };

  return (
    <div className="container mx-auto p-4">
      <div className="mb-6 flex items-center">
        <Button variant="ghost" size="sm" className="mr-2" asChild>
          <Link href={`/${lang}/dashboard/servers`}>
            <ArrowLeft className="mr-1 h-4 w-4" />
            {t("BackToServers")}
          </Link>
        </Button>
        <h1 className="text-2xl font-bold">{t("AddNewServer")}</h1>
      </div>

      <div className="bg-card border-input mx-auto max-w-4xl rounded-lg border p-6">
        <ServerForm isEditing={false} onSuccess={handleSuccess} lang={lang} />
      </div>
    </div>
  );
}
