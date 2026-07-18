"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";

const errorMessages: Record<string, string> = {
  CredentialsSignin: "Invalid email or password.",
  SessionRequired: "You must be signed in to continue.",
  AccessDenied: "You do not have permission to access this resource.",
  CallbackRouteError: "There was a problem during the authentication callback.",
  OAuthAccountNotLinked:
    "Sign in with the same provider you originally used for this account.",
  EmailSignin: "The email sign-in link is invalid or has expired.",
  CredentialsSignup:
    "We couldn't create your account. Please try again or contact support.",
  OAuthSignin: "There was a problem signing in with your provider.",
  OAuthCallback: "The OAuth provider returned an error.",
  Configuration: "The authentication system is misconfigured.",
};

const defaultErrorMessage =
  "An unknown authentication error occurred. Please try again.";

export default function ErrorPage() {
  const searchParams = useSearchParams();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    const error = searchParams?.get("error");
    if (error) {
      setErrorMessage(getErrorMessage(error));
    }
  }, [searchParams]);

  const getErrorMessage = (error: string): string =>
    errorMessages[error] ?? defaultErrorMessage;

  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4 py-12 sm:px-6 lg:px-8">
      <div className="w-full max-w-md space-y-8 text-center">
        <div>
          <h2 className="mt-6 text-3xl font-bold tracking-tight">
            Authentication Error
          </h2>
          <div className="mt-4 flex justify-center">
            <div className="rounded-full bg-red-100 p-4">
              <AlertTriangle className="text-destructive h-8 w-8" />
            </div>
          </div>
          {errorMessage && (
            <p className="text-destructive mt-4 font-medium">{errorMessage}</p>
          )}
          <p className="mt-2 text-sm text-gray-500">
            There was a problem with your authentication request. Please try
            again.
          </p>
        </div>
        <div className="mt-6 space-y-4">
          <div>
            <Link
              href="/auth/signin"
              className="bg-primary dark:bg-secondary text-primary-foreground dark:text-secondary-foreground hover:bg-primary/90 dark:hover:bg-secondary/90 flex w-full justify-center rounded-md border border-transparent px-4 py-2 text-sm font-medium"
            >
              Return to Sign In
            </Link>
          </div>
          <div>
            <Link
              href="/"
              className="flex w-full justify-center rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:bg-slate-950 dark:text-gray-300 dark:hover:bg-slate-900"
            >
              Return to Home Page
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
