export default function AdminDashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Admin-only sections
  // Access control is handled by middleware and individual pages
  return <>{children}</>;
}
