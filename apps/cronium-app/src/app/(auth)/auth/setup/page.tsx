import { redirect } from "next/navigation";
import { isSetupRequired } from "@/lib/first-run";
import { isBootstrapTokenRequired } from "@/app/(auth)/auth/setup/actions";
import SetupForm from "@/components/auth/SetupForm";

export const dynamic = "force-dynamic";

export default async function SetupPage() {
  if (!(await isSetupRequired())) {
    redirect("/auth/signin");
  }

  const bootstrapTokenRequired = await isBootstrapTokenRequired();
  return <SetupForm bootstrapTokenRequired={bootstrapTokenRequired} />;
}
