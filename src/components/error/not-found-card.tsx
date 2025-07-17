import Link from "next/link";
import { FileQuestion, Home, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

interface NotFoundCardProps {
  title?: string;
  description?: string;
  showHomeButton?: boolean;
  showBackButton?: boolean;
  lang?: string;
}

export function NotFoundCard({
  title = "Page Not Found",
  description = "The page you're looking for doesn't exist or has been moved.",
  showHomeButton = true,
  showBackButton = true,
  lang = "en",
}: NotFoundCardProps) {
  const homeHref = lang !== "en" ? `/${lang}/dashboard` : "/dashboard";

  return (
    <div className="flex min-h-[400px] items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="bg-muted mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full">
            <FileQuestion className="text-muted-foreground h-6 w-6" />
          </div>
          <CardTitle className="text-2xl">404 - {title}</CardTitle>
          <CardDescription className="mt-2">{description}</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-center text-sm">
            Error Code: 404 | Not Found
          </p>
        </CardContent>
        <CardFooter className="flex justify-center gap-2">
          {showBackButton && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => window.history.back()}
            >
              <ArrowLeft className="mr-2 h-4 w-4" />
              Go Back
            </Button>
          )}
          {showHomeButton && (
            <Button asChild size="sm">
              <Link href={homeHref}>
                <Home className="mr-2 h-4 w-4" />
                Dashboard
              </Link>
            </Button>
          )}
        </CardFooter>
      </Card>
    </div>
  );
}
