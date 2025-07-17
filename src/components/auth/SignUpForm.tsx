"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { registerUser } from "@/app/[lang]/(auth)/auth/signup/actions";
import { useLanguage } from "@/components/providers/language-provider";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

const signupSchema = z
  .object({
    username: z.string().min(3, "Username must be at least 3 characters"),
    email: z.string().email("Please enter a valid email address"),
    password: z
      .string()
      .min(8, "Password must be at least 8 characters")
      .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
      .regex(/[a-z]/, "Password must contain at least one lowercase letter")
      .regex(/[0-9]/, "Password must contain at least one number"),
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

type FormData = z.infer<typeof signupSchema>;

export default function SignUpForm() {
  const router = useRouter();
  const { locale, t } = useLanguage();

  const [registrationComplete, setRegistrationComplete] = useState(false);
  const [successMessage, setSuccessMessage] = useState("");

  const form = useForm<FormData>({
    resolver: zodResolver(signupSchema),
    defaultValues: {
      username: "",
      email: "",
      password: "",
      confirmPassword: "",
    },
  });

  const {
    handleSubmit,
    formState: { errors, isSubmitting },
    setError,
  } = form;

  const onSubmit = async (data: FormData) => {
    try {
      // Use the server action to handle password hashing and user creation
      const result = await registerUser({
        username: data.username,
        email: data.email,
        password: data.password,
      });

      if (!result.success) {
        setError("root.serverError", {
          type: "manual",
          message: result.error ?? t("Auth.RegistrationFailed"),
        });
        return;
      }

      // Registration successful
      setSuccessMessage(result.message ?? t("Auth.RegistrationSuccessful"));
      setRegistrationComplete(true);

      // After a delay, redirect to sign in page
      setTimeout(() => {
        router.push(`/${locale}/auth/signin`);
      }, 3000);
    } catch (error) {
      console.error("Registration error:", error);
      setError("root.serverError", {
        type: "manual",
        message: t("Auth.UnexpectedError"),
      });
    }
  };

  if (registrationComplete) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center px-4 py-12 sm:px-6 lg:px-8">
        <div
          className="w-full max-w-md space-y-8 text-center"
          data-testid="signup-success"
        >
          <div>
            <h1 className="text-primary dark:text-secondary text-4xl font-bold tracking-tight">
              Cronium
            </h1>
            <h2 className="mt-6 text-3xl font-bold tracking-tight text-green-600">
              {t("Auth.RegistrationSuccessful")}
            </h2>
            <p className="mt-2 text-sm text-gray-600">{successMessage}</p>
            <p className="mt-2 text-sm text-gray-500">
              {t("Auth.AccountCreatedRedirect")}
            </p>
            <Link
              href={`/${locale}/auth/signin`}
              className="bg-primary dark:bg-secondary text-primary-foreground dark:text-secondary-foreground hover:bg-primary/90 dark:hover:bg-secondary/90 mt-4 inline-block rounded-md border border-transparent px-4 py-2 text-sm font-medium"
            >
              {t("Auth.SignInNow")}
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4 py-12 sm:px-6 lg:px-8">
      <div className="w-full max-w-md space-y-8">
        <div className="text-center">
          <h1 className="text-primary dark:text-secondary text-4xl font-bold tracking-tight">
            Cronium
          </h1>
          <h2 className="mt-6 text-3xl font-bold tracking-tight">
            {t("Auth.CreateAccount")}
          </h2>
          <p className="mt-2 text-sm text-gray-500">
            {t("Auth.AlreadyHaveAccount")}{" "}
            <Link
              href={`/${locale}/auth/signin`}
              className="text-primary hover:text-primary/80 dark:text-secondary dark:hover:text-secondary/80 font-medium"
            >
              {t("Auth.SignIn")}
            </Link>
          </p>
        </div>

        {errors.root?.serverError && (
          <div className="rounded-md bg-red-50 p-4">
            <div className="flex">
              <div className="ml-3">
                <h3 className="text-sm font-medium text-red-800">
                  {t("Common.Error")}
                </h3>
                <div className="mt-2 text-sm text-red-700">
                  <p>{errors.root.serverError.message}</p>
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
                      {t("Auth.Username")}
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

              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel htmlFor="email">
                      {t("Auth.EmailAddress")}
                    </FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        id="email"
                        type="email"
                        autoComplete="email"
                        required
                        placeholder={t("Auth.EmailPlaceholder")}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel htmlFor="password">
                      {t("Auth.Password")}
                    </FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        id="password"
                        type="password"
                        autoComplete="new-password"
                        required
                        placeholder="••••••••"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="confirmPassword"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel htmlFor="confirmPassword">
                      {t("Auth.ConfirmPassword")}
                    </FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        id="confirmPassword"
                        type="password"
                        autoComplete="new-password"
                        required
                        placeholder="••••••••"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div>
              <Button type="submit" disabled={isSubmitting} className="w-full">
                {isSubmitting
                  ? t("Auth.CreatingAccount")
                  : t("Auth.CreateAccount")}
              </Button>
            </div>
          </form>
        </Form>
      </div>
    </div>
  );
}
