import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { hasServerPermission } from "@/server/permissions";
import ConsoleClient from "./ConsoleClient";

export async function generateMetadata() {
  return {
    title: "Console",
    description: "Execute and manage server commands via the terminal",
  };
}

export default async function ConsolePage() {
  // Check authentication
  const session = await getServerSession(authOptions);

  if (!session) {
    redirect("/auth/signin");
  }

  // Check console permission (admins always pass)
  if (!(await hasServerPermission(session.user.id, "console"))) {
    redirect("/dashboard");
  }

  return <ConsoleClient />;
}
