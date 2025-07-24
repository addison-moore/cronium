"use client";

import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useLanguage } from "@/components/providers/language-provider";
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
});

type FormData = z.infer<typeof signinSchema>;

export default function SignIn() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { locale, t } = useLanguage();

  const form = useForm<FormData>({
    resolver: zodResolver(signinSchema),
    defaultValues: {
      username: "",
      password: "",
    },
  });

  const {
    handleSubmit,
    formState: { errors, isSubmitting },
    setError,
  } = form;

  // Get error message from URL if it exists (from NextAuth)
  const errorParam = searchParams?.get("error");
  // Use locale-prefixed dashboard URL as default callback if none provided
  const callbackUrl =
    searchParams?.get("callbackUrl") ?? `/${locale}/dashboard`;

  // Set error message based on NextAuth error
  const getErrorFromParams = () => {
    if (!errorParam) return null;

    switch (errorParam) {
      case "CredentialsSignin":
        return t("Auth.InvalidCredentials");
      case "SessionRequired":
        return t("Auth.SessionRequired");
      default:
        return t("Auth.GeneralError");
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
      });

      if (!result.success) {
        setError("root.serverError", {
          type: "manual",
          message: t("Auth.InvalidCredentials"),
        });
        return;
      }

      // Successfully authenticated, now create NextAuth session
      const nextAuthResult = await signIn("credentials", {
        redirect: false,
        username: data.username,
        password: data.password,
      });

      if (nextAuthResult?.error) {
        setError("root.serverError", {
          type: "manual",
          message: t("Auth.InvalidCredentials"),
        });
        return;
      }

      // Successfully signed in, redirect to dashboard
      let redirectUrl = callbackUrl;

      // If the callback URL doesn't have a language prefix and it's a relative path
      if (
        redirectUrl.startsWith("/") &&
        !/^\/[a-z]{2}(?:\/|$)/.exec(redirectUrl)
      ) {
        // Add current language prefix to the URL
        redirectUrl = `/${locale}${redirectUrl}`;
      }

      router.push(redirectUrl);
      router.refresh();
    } catch (error) {
      console.error("Sign in error:", error);
      setError("root.serverError", {
        type: "manual",
        message:
          error instanceof Error ? error.message : t("Auth.UnexpectedError"),
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
            {t("Auth.SignInTitle")}
          </h2>
          <p className="mt-2 text-sm text-gray-500">
            {t("Auth.OrText")}{" "}
            <Link
              href={`/${locale}/auth/signup`}
              className="text-primary hover:text-primary/80 dark:text-secondary dark:hover:text-secondary/80 font-medium"
            >
              {t("Auth.CreateAccount")}
            </Link>
          </p>
        </div>

        {(errors.root?.serverError ?? errorFromParams) && (
          <div className="rounded-md bg-red-50 p-4">
            <div className="flex">
              <div className="ml-3">
                <h3 className="text-sm font-medium text-red-800">
                  {t("Common.Error")}
                </h3>
                <div className="mt-2 text-sm text-red-700">
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
                      {t("Auth.UsernameOrEmail")}
                    </FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        id="username"
                        type="text"
                        autoComplete="username"
                        required
                        placeholder={t("Auth.UsernamePlaceholder")}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div>
                <div className="flex items-center justify-between">
                  <FormLabel htmlFor="password">{t("Auth.Password")}</FormLabel>
                  <div className="text-sm">
                    <Link
                      href={`/${locale}/auth/forgot-password`}
                      className="text-primary hover:text-primary/80 dark:text-secondary dark:hover:text-secondary/80 font-medium"
                    >
                      {t("Auth.ForgotPassword")}
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
            </div>

            <div>
              <Button type="submit" disabled={isSubmitting} className="w-full">
                {isSubmitting ? t("Auth.SigningIn") : t("Auth.SignIn")}
              </Button>
            </div>
          </form>
        </Form>
      </div>
    </div>
  );
}
