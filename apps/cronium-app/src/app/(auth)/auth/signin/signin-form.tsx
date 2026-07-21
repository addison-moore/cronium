"use client";

import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import Link from "next/link";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { trpc } from "@/lib/trpc";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@cronium/ui";
import { Input } from "@cronium/ui";
import { Button } from "@cronium/ui";

const signinSchema = z.object({
  username: z.string().min(1, "Username or email is required"),
  password: z.string().min(1, "Password is required"),
  totp: z.string().optional(),
});

type FormData = z.infer<typeof signinSchema>;

const copy = {
  heading: "Sign in to your account",
  subtextPrefix: "Need an account?",
  createAccount: "Create a new account",
  errorHeading: "Error",
  usernameLabel: "Username or Email",
  usernamePlaceholder: "you@example.com",
  passwordLabel: "Password",
  totpLabel: "Authenticator code",
  totpHint:
    "Enter the 6-digit code from your authenticator app, or a recovery code.",
  mfaPrompt: "Enter your authenticator code to finish signing in.",
  forgotPassword: "Forgot your password?",
  submitIdle: "Sign In",
  submitBusy: "Signing in...",
  invalidCredentials: "Invalid username/email or password.",
  invalidMfa: "Invalid authenticator or recovery code.",
  sessionRequired: "You must be signed in to continue.",
  generalError: "Something went wrong. Please try again.",
  unexpectedError: "An unexpected error occurred. Please try again.",
};

export default function SignIn() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [mfaRequired, setMfaRequired] = useState(false);

  const form = useForm<FormData>({
    resolver: zodResolver(signinSchema),
    defaultValues: {
      username: "",
      password: "",
      totp: "",
    },
  });

  const {
    handleSubmit,
    formState: { errors, isSubmitting },
    setError,
  } = form;

  // Get error message from URL if it exists (from NextAuth)
  const errorParam = searchParams?.get("error");
  // Use dashboard URL as default callback if none provided
  const callbackUrl = searchParams?.get("callbackUrl") ?? "/dashboard";

  // Set error message based on NextAuth error
  const getErrorFromParams = () => {
    if (!errorParam) return null;

    switch (errorParam) {
      case "CredentialsSignin":
        return copy.invalidCredentials;
      case "SessionRequired":
        return copy.sessionRequired;
      default:
        return copy.generalError;
    }
  };

  const errorFromParams = getErrorFromParams();

  // tRPC login mutation
  const loginMutation = trpc.userAuth.login.useMutation();

  const onSubmit = async (data: FormData) => {
    try {
      // Use tRPC authentication endpoint
      const result = await loginMutation.mutateAsync({
        username: data.username,
        password: data.password,
        ...(data.totp ? { totp: data.totp } : {}),
      });

      if (!result.success) {
        // Password was accepted but a second factor is needed: reveal the code
        // field and prompt, without treating it as a credential failure.
        if ("mfaRequired" in result && result.mfaRequired) {
          setMfaRequired(true);
          setError("root.serverError", {
            type: "manual",
            message: copy.mfaPrompt,
          });
          return;
        }
        setError("root.serverError", {
          type: "manual",
          message: copy.invalidCredentials,
        });
        return;
      }

      // Successfully authenticated, now create NextAuth session (this is the
      // authority that verifies and consumes the second factor).
      const nextAuthResult = await signIn("credentials", {
        redirect: false,
        username: data.username,
        password: data.password,
        ...(data.totp ? { totp: data.totp } : {}),
      });

      if (nextAuthResult?.error) {
        // A correct password with a missing/invalid factor surfaces here.
        if (nextAuthResult.error === "MFA_REQUIRED") {
          setMfaRequired(true);
          setError("root.serverError", {
            type: "manual",
            message: copy.mfaPrompt,
          });
          return;
        }
        setError("root.serverError", {
          type: "manual",
          message: mfaRequired ? copy.invalidMfa : copy.invalidCredentials,
        });
        return;
      }

      // Successfully signed in, redirect to dashboard
      const redirectUrl = callbackUrl;

      // If the callback URL doesn't have a language prefix and it's a relative path
      router.push(redirectUrl);
      router.refresh();
    } catch (error) {
      console.error("Sign in error:", error);
      setError("root.serverError", {
        type: "manual",
        message: error instanceof Error ? error.message : copy.unexpectedError,
      });
    }
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4 py-12 sm:px-6 lg:px-8">
      <div className="w-full max-w-md space-y-8">
        <div className="text-center">
          <h1 className="text-primary dark:text-secondary text-4xl font-bold tracking-tight">
            Cronium
          </h1>
          <h2 className="mt-6 text-3xl font-bold tracking-tight">
            {copy.heading}
          </h2>
          <p className="mt-2 text-sm text-gray-500">
            {copy.subtextPrefix}{" "}
            <Link
              href="/auth/signup"
              className="text-primary hover:text-primary/80 dark:text-secondary dark:hover:text-secondary/80 font-medium"
            >
              {copy.createAccount}
            </Link>
          </p>
        </div>

        {(errors.root?.serverError ?? errorFromParams) && (
          <div className="bg-destructive/10 rounded-md p-4">
            <div className="flex">
              <div className="ml-3">
                <h3 className="text-destructive-text text-sm font-medium">
                  {copy.errorHeading}
                </h3>
                <div className="text-destructive-text mt-2 text-sm">
                  <p>{errors.root?.serverError?.message ?? errorFromParams}</p>
                </div>
              </div>
            </div>
          </div>
        )}

        <Form {...form}>
          <form onSubmit={handleSubmit(onSubmit)} className="mt-8 space-y-6">
            <div className="space-y-4 rounded-md shadow-sm">
              <FormField
                control={form.control}
                name="username"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel htmlFor="username">
                      {copy.usernameLabel}
                    </FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        id="username"
                        type="text"
                        autoComplete="username"
                        required
                        placeholder={copy.usernamePlaceholder}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div>
                <div className="flex items-center justify-between">
                  <FormLabel htmlFor="password">{copy.passwordLabel}</FormLabel>
                  <div className="text-sm">
                    <Link
                      href="/auth/forgot-password"
                      className="text-primary hover:text-primary/80 dark:text-secondary dark:hover:text-secondary/80 font-medium"
                    >
                      {copy.forgotPassword}
                    </Link>
                  </div>
                </div>
                <FormField
                  control={form.control}
                  name="password"
                  render={({ field }) => (
                    <FormItem>
                      <FormControl>
                        <Input
                          {...field}
                          id="password"
                          type="password"
                          autoComplete="current-password"
                          required
                          placeholder="••••••••"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              {mfaRequired && (
                <FormField
                  control={form.control}
                  name="totp"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel htmlFor="totp">{copy.totpLabel}</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          id="totp"
                          type="text"
                          inputMode="numeric"
                          autoComplete="one-time-code"
                          autoFocus
                          placeholder="123456"
                        />
                      </FormControl>
                      <p className="text-xs text-gray-500">{copy.totpHint}</p>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}
            </div>

            <div>
              <Button type="submit" disabled={isSubmitting} className="w-full">
                {isSubmitting ? copy.submitBusy : copy.submitIdle}
              </Button>
            </div>
          </form>
        </Form>
      </div>
    </div>
  );
}
