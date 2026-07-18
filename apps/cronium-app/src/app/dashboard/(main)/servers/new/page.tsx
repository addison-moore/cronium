"use client";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Button, PageShell } from "@cronium/ui";
import ServerForm from "@/components/dashboard/ServerForm";

export default function NewServerPage() {
  const router = useRouter();

  const handleSuccess = (serverId?: number) => {
    if (serverId) {
      router.push(`/dashboard/servers/${serverId}`);
    } else {
      router.push(`/dashboard/servers`);
    }
  };

  return (
    <PageShell>
      <div className="mb-6 flex items-center">
        <Button variant="ghost" size="sm" className="mr-2" asChild>
          <Link href="/dashboard/servers">
            <ArrowLeft className="mr-1 h-4 w-4" />
            Back to Servers
          </Link>
        </Button>
        <h1 className="text-2xl font-semibold">Add New Server</h1>
      </div>

      <div className="bg-card border-input mx-auto max-w-4xl rounded-lg border p-6">
        <ServerForm isEditing={false} onSuccess={handleSuccess} />
      </div>
    </PageShell>
  );
}
