import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center">
      <div className="text-center">
        <h2 className="mb-4 text-2xl font-bold">404 - Page Not Found</h2>
        <p className="text-muted-foreground mb-4">
          The page you are looking for does not exist.
        </p>
        <Link
          href="/"
          className="bg-primary text-primary-foreground hover:bg-primary/90 inline-block rounded-md px-4 py-2"
        >
          Return Home
        </Link>
      </div>
    </div>
  );
}
