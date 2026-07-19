import { redirect } from "next/navigation";
import { isSetupRequired } from "@/lib/first-run";
import SignIn from "./signin-form";

export const dynamic = "force-dynamic";

export default async function SignInPage() {
  if (await isSetupRequired()) {
    redirect("/auth/setup");
  }

  return <SignIn />;
}
