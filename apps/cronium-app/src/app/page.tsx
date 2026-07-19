import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { isSetupRequired } from "@/lib/first-run";

// The setup check queries the database, which must not run at build time.
export const dynamic = "force-dynamic";

export default async function RootPage() {
  if (await isSetupRequired()) {
    redirect("/auth/setup");
  }

  const session = await getServerSession(authOptions);

  if (session) {
    redirect("/dashboard");
  }

  redirect("/auth/signin");
}
