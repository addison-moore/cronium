import { NotFoundCard } from "@/components/error/not-found-card";

export default function NotFound({ params }: { params?: { lang?: string } }) {
  return (
    <NotFoundCard
      title="Page Not Found"
      description="The page you're looking for doesn't exist or has been moved."
      showHomeButton={true}
      showBackButton={true}
      lang={params?.lang ?? "en"}
    />
  );
}
