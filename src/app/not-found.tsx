import { NotFoundCard } from "@/components/error/not-found-card";

export default function NotFound() {
  return (
    <NotFoundCard
      title="Page Not Found"
      description="The page you're looking for doesn't exist or has been moved."
      showHomeButton={true}
      showBackButton={true}
      lang="en"
    />
  );
}
