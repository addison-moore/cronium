import { NotFoundCard } from "@/components/error/not-found-card";

export default function DocsNotFound({
  params,
}: {
  params?: { lang?: string };
}) {
  return (
    <NotFoundCard
      title="Documentation Not Found"
      description="The documentation page you're looking for doesn't exist. Please check the URL or browse our documentation index."
      showHomeButton={true}
      showBackButton={true}
      lang={params?.lang ?? "en"}
    />
  );
}
