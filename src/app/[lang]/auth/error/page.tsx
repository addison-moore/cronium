/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */

"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { useLanguage } from "@/components/providers/language-provider";

export default function ErrorPage() {
  const searchParams = useSearchParams();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const { locale, t } = useLanguage();

  useEffect(() => {
    const error = searchParams?.get("error");
    if (error) {
      setErrorMessage(getErrorMessage(error));
    }
  }, [searchParams]);

  // Convert the error code to a user-friendly message
  function getErrorMessage(error: string): string {
    switch (error) {
      case "CredentialsSignin":
        return t("Auth.InvalidCredentials");
      case "SessionRequired":
        return t("Auth.SessionRequired");
      case "AccessDenied":
        return t("Auth.AccessDenied");
      case "CallbackRouteError":
        return t("Auth.CallbackRouteError");
      case "OAuthAccountNotLinked":
        return t("Auth.OAuthAccountNotLinked");
      case "EmailSignin":
        return t("Auth.EmailSigninError");
      case "CredentialsSignup":
        return t("Auth.CredentialsSignupError");
      case "OAuthSignin":
        return t("Auth.OAuthSigninError");
      case "OAuthCallback":
        return t("Auth.OAuthCallbackError");
      case "Configuration":
        return t("Auth.ConfigurationError");
      default:
        return t("Auth.UnknownAuthError");
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4 py-12 sm:px-6 lg:px-8">
      <div className="w-full max-w-md space-y-8 text-center">
        <div>
          <h2 className="mt-6 text-3xl font-bold tracking-tight">
            {t("Auth.AuthenticationError")}
          </h2>
          <div className="mt-4 flex justify-center">
            <div className="rounded-full bg-red-100 p-4">
              <AlertTriangle className="h-8 w-8 text-red-600" />
            </div>
          </div>
          {errorMessage && (
            <p className="mt-4 font-medium text-red-600">{errorMessage}</p>
          )}
          <p className="mt-2 text-sm text-gray-500">
            {t("Auth.AuthProblemMessage")}
          </p>
        </div>
        <div className="mt-6 space-y-4">
          <div>
            <Link
              href={`/${locale}/auth/signin`}
              className="bg-primary dark:bg-secondary text-primary-foreground dark:text-secondary-foreground hover:bg-primary/90 dark:hover:bg-secondary/90 flex w-full justify-center rounded-md border border-transparent px-4 py-2 text-sm font-medium"
            >
              {t("Auth.ReturnToSignIn")}
            </Link>
          </div>
          <div>
            <Link
              href={`/${locale}`}
              className="flex w-full justify-center rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:bg-slate-950 dark:text-gray-300 dark:hover:bg-slate-900"
            >
              {t("Auth.ReturnToHomePage")}
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
