export default async function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Auth layout for authentication pages
  // Individual pages handle their own authentication checks

  return (
    <div className="from-background to-muted flex min-h-screen items-center justify-center bg-gradient-to-br">
      <div className="w-full max-w-md">{children}</div>
    </div>
  );
}
