/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */

"use client";

import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { AlertCircle, CheckCircle2 } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";

// Define the form schema
const accountActivationSchema = z
  .object({
    password: z
      .string()
      .min(8, { message: "Password must be at least 8 characters" })
      .max(72, { message: "Password cannot exceed 72 characters" }),
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

type AccountActivationFormData = z.infer<typeof accountActivationSchema>;

export default function ActivatePage() {
  const t = useTranslations("Auth");
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token");

  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [activationStatus, setActivationStatus] = useState<
    "idle" | "loading" | "success" | "error"
  >("idle");
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [tokenVerified, setTokenVerified] = useState<boolean | null>(null);
  const [userEmail, setUserEmail] = useState<string>("");

  const form = useForm<AccountActivationFormData>({
    resolver: zodResolver(accountActivationSchema),
    defaultValues: {
      password: "",
      confirmPassword: "",
    },
  });

  // Verify token on page load
  useEffect(() => {
    if (!token) {
      setTokenVerified(false);
      setErrorMessage("No activation token provided");
      return;
    }

    async function verifyToken() {
      try {
        if (!token) return;
        console.log("Verifying token:", token);
        const response = await fetch(
          `/api/auth/verify-token?token=${encodeURIComponent(token)}`,
        );

        const data = await response.json();
        console.log("Token verification response:", data);

        if (!response.ok) {
          setTokenVerified(false);
          setErrorMessage(
            data.message ?? "Invalid or expired invitation token",
          );
          return;
        }

        setTokenVerified(true);
        setUserEmail(data.email ?? "");
      } catch (error) {
        console.error("Error verifying token:", error);
        setTokenVerified(false);
        setErrorMessage("An error occurred while verifying your token");
      }
    }

    void verifyToken();
  }, [token]);

  const onSubmit = async (data: AccountActivationFormData) => {
    if (!token) return;

    setIsSubmitting(true);
    setActivationStatus("loading");

    try {
      const response = await fetch("/api/auth/activate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          token,
          password: data.password,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message ?? "Failed to activate account");
      }

      setActivationStatus("success");

      // Redirect to signin page after a short delay
      setTimeout(() => {
        router.push("/auth/signin");
      }, 3000);
    } catch (error: any) {
      console.error("Error activating account:", error);
      setActivationStatus("error");
      setErrorMessage(
        error.message ?? "Failed to activate your account. Please try again.",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  // Handle token verification loading state
  if (tokenVerified === null) {
    return (
      <div className="container flex min-h-screen items-center justify-center py-10">
        <Card className="w-full max-w-md">
          <CardHeader className="space-y-1 text-center">
            <CardTitle className="text-2xl">{t("ActivatingAccount")}</CardTitle>
            <CardDescription>{t("VerifyingToken")}</CardDescription>
          </CardHeader>
          <CardContent className="flex justify-center py-6">
            <div className="flex animate-pulse space-x-4">
              <div className="bg-muted h-12 w-12 rounded-full"></div>
              <div className="flex-1 space-y-4 py-1">
                <div className="bg-muted h-4 w-3/4 rounded"></div>
                <div className="space-y-2">
                  <div className="bg-muted h-4 rounded"></div>
                  <div className="bg-muted h-4 w-5/6 rounded"></div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Handle invalid token
  if (tokenVerified === false) {
    return (
      <div className="container flex min-h-screen items-center justify-center py-10">
        <Card className="w-full max-w-md">
          <CardHeader className="space-y-1 text-center">
            <CardTitle className="text-2xl">{t("InvalidToken")}</CardTitle>
            <CardDescription>{errorMessage}</CardDescription>
          </CardHeader>
          <CardContent className="flex justify-center py-6">
            <AlertCircle className="text-destructive h-16 w-16" />
          </CardContent>
          <CardFooter className="flex justify-center">
            <Button asChild>
              <Link href="/auth/signin">{t("BackToSignIn")}</Link>
            </Button>
          </CardFooter>
        </Card>
      </div>
    );
  }

  // Handle success state
  if (activationStatus === "success") {
    return (
      <div className="container flex min-h-screen items-center justify-center py-10">
        <Card className="w-full max-w-md">
          <CardHeader className="space-y-1 text-center">
            <CardTitle className="text-2xl">{t("AccountActivated")}</CardTitle>
            <CardDescription>
              {t("AccountActivatedDescription")}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex justify-center py-6">
            <CheckCircle2 className="h-16 w-16 text-green-500" />
          </CardContent>
          <CardFooter className="flex justify-center">
            <p>{t("RedirectingToSignIn")}</p>
          </CardFooter>
        </Card>
      </div>
    );
  }

  // Render account activation form
  return (
    <div className="container flex min-h-screen items-center justify-center py-10">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-1">
          <CardTitle className="text-2xl">{t("ActivateYourAccount")}</CardTitle>
          <CardDescription>
            {userEmail
              ? t("SetPasswordFor", { email: userEmail })
              : t("SetYourPassword")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="password">{t("Password")}</Label>
              <Input
                id="password"
                type="password"
                {...form.register("password")}
                disabled={isSubmitting}
              />
              {form.formState.errors.password && (
                <p className="text-destructive text-sm">
                  {form.formState.errors.password.message}
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirmPassword">{t("ConfirmPassword")}</Label>
              <Input
                id="confirmPassword"
                type="password"
                {...form.register("confirmPassword")}
                disabled={isSubmitting}
              />
              {form.formState.errors.confirmPassword && (
                <p className="text-destructive text-sm">
                  {form.formState.errors.confirmPassword.message}
                </p>
              )}
            </div>

            {activationStatus === "error" && (
              <div className="bg-destructive/10 text-destructive flex items-center gap-2 rounded-md p-3">
                <AlertCircle className="h-4 w-4" />
                <p className="text-sm">{errorMessage}</p>
              </div>
            )}

            <Button type="submit" className="w-full" disabled={isSubmitting}>
              {isSubmitting ? t("Activating") : t("ActivateAccount")}
            </Button>
          </form>
        </CardContent>
        <CardFooter className="flex justify-center">
          <p className="text-muted-foreground text-sm">
            {t("AlreadyHaveAccount")}{" "}
            <Link href="/auth/signin" className="text-primary underline">
              {t("SignIn")}
            </Link>
          </p>
        </CardFooter>
      </Card>
    </div>
  );
}
