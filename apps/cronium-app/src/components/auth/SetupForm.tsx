"use client";

import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { createFirstAdmin } from "@/app/(auth)/auth/setup/actions";
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

const setupSchema = z
  .object({
    username: z.string().min(3, "Username must be at least 3 characters"),
    email: z.string().email("Please enter a valid email address"),
    password: z
      .string()
      .min(12, "Password must be at least 12 characters")
      .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
      .regex(/[a-z]/, "Password must contain at least one lowercase letter")
      .regex(/[0-9]/, "Password must contain at least one number"),
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

type FormData = z.infer<typeof setupSchema>;

const copy = {
  formTitle: "Welcome to Cronium",
  subtitle:
    "This instance has no users yet. Create the administrator account to finish setup.",
  errorHeading: "Error",
  usernameLabel: "Admin username",
  usernamePlaceholder: "admin",
  emailLabel: "Email address",
  emailPlaceholder: "you@example.com",
  passwordLabel: "Password",
  confirmPasswordLabel: "Confirm Password",
  submitIdle: "Create Admin Account",
  submitBusy: "Creating account...",
  setupFailed: "Setup failed. Please try again.",
  unexpectedError: "An unexpected error occurred. Please try again.",
};

export default function SetupForm() {
  const router = useRouter();

  const form = useForm<FormData>({
    resolver: zodResolver(setupSchema),
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
      const result = await createFirstAdmin({
        username: data.username,
        email: data.email,
        password: data.password,
      });

      if (!result.success) {
        setError("root.serverError", {
          type: "manual",
          message: result.error ?? copy.setupFailed,
        });
        return;
      }

      // Sign the new admin in directly; fall back to the sign-in page if the
      // session can't be established.
      const nextAuthResult = await signIn("credentials", {
        redirect: false,
        username: data.username,
        password: data.password,
      });

      if (nextAuthResult?.error) {
        router.push("/auth/signin");
        return;
      }

      router.push("/dashboard");
      router.refresh();
    } catch (error) {
      console.error("First-run setup error:", error);
      setError("root.serverError", {
        type: "manual",
        message: copy.unexpectedError,
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
            {copy.formTitle}
          </h2>
          <p className="mt-2 text-sm text-gray-500">{copy.subtitle}</p>
        </div>

        {errors.root?.serverError && (
          <div className="bg-destructive/10 rounded-md p-4">
            <div className="flex">
              <div className="ml-3">
                <h3 className="text-destructive-text text-sm font-medium">
                  {copy.errorHeading}
                </h3>
                <div className="text-destructive-text mt-2 text-sm">
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

              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel htmlFor="email">{copy.emailLabel}</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        id="email"
                        type="email"
                        autoComplete="email"
                        required
                        placeholder={copy.emailPlaceholder}
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
                      {copy.passwordLabel}
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
                      {copy.confirmPasswordLabel}
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
                {isSubmitting ? copy.submitBusy : copy.submitIdle}
              </Button>
            </div>
          </form>
        </Form>
      </div>
    </div>
  );
}
