import { notFound } from "next/navigation";

// Root page - middleware will handle the redirect
export default function RootPage() {
  // This should never be reached due to middleware redirects
  return notFound();
}
