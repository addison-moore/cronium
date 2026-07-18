"use client";

import { useState, useEffect } from "react";
import { signOut } from "next-auth/react";
import { useRouter } from "next/navigation";

const copy = {
  heading: "Signing you out",
  description: "Please wait, this will only take a moment.",
  error: "We couldn't sign you out. Please try again.",
  tryAgain: "Try Again",
};

export default function SignOut() {
  const router = useRouter();
  const [isSigningOut, setIsSigningOut] = useState(true);

  useEffect(() => {
    const handleSignOut = async () => {
      try {
        await signOut({
          redirect: false,
          callbackUrl: "/",
        });

        router.push("/");
      } catch (error) {
        console.error("Sign out error:", error);
        setIsSigningOut(false);
      }
    };

    void handleSignOut();
  }, [router]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4 py-12 sm:px-6 lg:px-8">
      <div className="w-full max-w-md space-y-8 text-center">
        <h2 className="mt-6 text-3xl font-bold tracking-tight">
          {copy.heading}
        </h2>
        <p className="mt-2 text-sm text-gray-500">{copy.description}</p>

        {!isSigningOut && (
          <div className="mt-6">
            <p className="text-destructive">{copy.error}</p>
            <button
              onClick={() => {
                setIsSigningOut(true);
                void signOut({ redirect: true, callbackUrl: "/" });
              }}
              className="bg-primary dark:bg-secondary text-primary-foreground dark:text-secondary-foreground hover:bg-primary/90 dark:hover:bg-secondary/90 focus:ring-primary dark:focus:ring-secondary mt-4 rounded-md border border-transparent px-4 py-2 text-sm font-medium focus:ring-2 focus:ring-offset-2 focus:outline-none"
            >
              {copy.tryAgain}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
