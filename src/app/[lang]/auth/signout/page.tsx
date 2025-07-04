/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */

"use client";

import { useState, useEffect } from "react";
import { signOut } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useLanguage } from "@/components/providers/language-provider";

export default function SignOut() {
  const router = useRouter();
  const { locale, t } = useLanguage();
  const [isSigningOut, setIsSigningOut] = useState(true);

  useEffect(() => {
    const handleSignOut = async () => {
      try {
        // Make sure to preserve the locale in the callback URL
        await signOut({
          redirect: false,
          callbackUrl: `/${locale}`,
        });

        // Explicitly navigate to the localized home page
        router.push(`/${locale}`);
      } catch (error) {
        console.error("Sign out error:", error);
        setIsSigningOut(false);
      }
    };

    void handleSignOut();
  }, [router, locale]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4 py-12 sm:px-6 lg:px-8">
      <div className="w-full max-w-md space-y-8 text-center">
        <h2 className="mt-6 text-3xl font-bold tracking-tight">
          {t("Auth.SigningOut")}
        </h2>
        <p className="mt-2 text-sm text-gray-500">
          {t("Auth.SigningOutMessage")}
        </p>

        {!isSigningOut && (
          <div className="mt-6">
            <p className="text-red-600">{t("Auth.SignOutError")}</p>
            <button
              onClick={() => {
                setIsSigningOut(true);
                void signOut({ redirect: true, callbackUrl: `/${locale}` });
              }}
              className="bg-primary dark:bg-secondary text-primary-foreground dark:text-secondary-foreground hover:bg-primary/90 dark:hover:bg-secondary/90 focus:ring-primary dark:focus:ring-secondary mt-4 rounded-md border border-transparent px-4 py-2 text-sm font-medium focus:ring-2 focus:ring-offset-2 focus:outline-none"
            >
              {t("Common.TryAgain")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
