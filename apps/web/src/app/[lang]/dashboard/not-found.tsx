import { NotFoundCard } from "@/components/error/not-found-card";

export default function DashboardNotFound({
  params,
}: {
  params?: { lang?: string };
}) {
  return (
    <NotFoundCard
      title="Dashboard Page Not Found"
      description="The dashboard page you're looking for doesn't exist. Please check the URL or navigate back to the main dashboard."
      showHomeButton={true}
      showBackButton={true}
      lang={params?.lang ?? "en"}
    />
  );
}
