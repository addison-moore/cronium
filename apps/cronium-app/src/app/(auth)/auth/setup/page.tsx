import { redirect } from "next/navigation";
import { isSetupRequired } from "@/lib/first-run";
import SetupForm from "@/components/auth/SetupForm";

export const dynamic = "force-dynamic";

export default async function SetupPage() {
  if (!(await isSetupRequired())) {
    redirect("/auth/signin");
  }

  return <SetupForm />;
}
