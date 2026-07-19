import { redirect } from "next/navigation";
import { isSetupRequired } from "@/lib/first-run";
import SignUpForm from "@/components/auth/SignUpForm";

export const dynamic = "force-dynamic";

export default async function SignUp() {
  if (await isSetupRequired()) {
    redirect("/auth/setup");
  }

  return <SignUpForm />;
}
