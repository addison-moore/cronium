"use client";

import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@cronium/ui";
import { Input } from "@cronium/ui";
import { Label } from "@cronium/ui";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@cronium/ui";
import { AlertCircle, CheckCircle2 } from "lucide-react";
import Link from "next/link";
import { trpc } from "@/lib/trpc";

// Define the form schema
const accountActivationSchema = z
  .object({
    password: z
      .string()
      .min(12, { message: "Password must be at least 12 characters" })
      .max(72, { message: "Password cannot exceed 72 characters" }),
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

type AccountActivationFormData = z.infer<typeof accountActivationSchema>;

const copy = {
  verifyingTitle: "Activating Account",
  verifyingDescription: "Verifying your invitation token...",
  invalidTitle: "Invalid or Expired Token",
  backToSignIn: "Back to Sign In",
  activatedTitle: "Account Activated",
  activatedDescription:
    "Your account is ready to use. Redirecting you to the sign-in page.",
  redirectMessage: "Redirecting to sign in...",
  formTitle: "Activate Your Account",
  formSubtitle: (email?: string) =>
    email ? `Set a password for ${email}` : "Set a password for your account",
  passwordLabel: "Password",
  confirmPasswordLabel: "Confirm Password",
  submitLabel: "Activate Account",
  submittingLabel: "Activating...",
  alreadyHaveAccount: "Already have an account?",
  signInLabel: "Sign In",
};

export default function ActivatePage() {
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

  // tRPC query for token verification
  const {
    data: verifyData,
    error: verifyError,
    isLoading: isVerifying,
  } = trpc.userAuth.verifyInviteToken.useQuery(
    { token: token ?? "" },
    {
      enabled: !!token,
      retry: false,
    },
  );

  // Handle verification results
  useEffect(() => {
    if (verifyError) {
      setTokenVerified(false);
      setErrorMessage(verifyError.message);
    } else if (verifyData) {
      setTokenVerified(true);
      setUserEmail(verifyData.email ?? "");
    }
  }, [verifyData, verifyError]);

  // Update token verification state
  useEffect(() => {
    if (!token) {
      setTokenVerified(false);
      setErrorMessage("No activation token provided");
    }
  }, [token]);

  // tRPC mutation for account activation
  const activateMutation = trpc.userAuth.activateAccount.useMutation({
    onSuccess: () => {
      setActivationStatus("success");
      // Redirect to signin page after a short delay
      setTimeout(() => {
        router.push("/auth/signin");
      }, 3000);
    },
    onError: (error) => {
      setActivationStatus("error");
      setErrorMessage(error.message);
    },
  });

  const onSubmit = async (data: AccountActivationFormData) => {
    if (!token) return;

    setIsSubmitting(true);
    setActivationStatus("loading");

    try {
      await activateMutation.mutateAsync({
        token,
        password: data.password,
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  // Handle token verification loading state
  if (isVerifying || tokenVerified === null) {
    return (
      <div className="container flex min-h-screen items-center justify-center py-10">
        <Card className="w-full max-w-md">
          <CardHeader className="space-y-1 text-center">
            <CardTitle className="text-2xl">{copy.verifyingTitle}</CardTitle>
            <CardDescription>{copy.verifyingDescription}</CardDescription>
          </CardHeader>
          <CardContent className="flex justify-center py-6">
            <div className="flex space-x-4 motion-safe:animate-pulse">
              <div className="bg-muted h-12 w-12 rounded-full"></div>
              <div className="flex-1 space-y-4 py-1">
                <div className="bg-muted h-4 w-3/4 rounded-md"></div>
                <div className="space-y-2">
                  <div className="bg-muted h-4 rounded-md"></div>
                  <div className="bg-muted h-4 w-5/6 rounded-md"></div>
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
            <CardTitle className="text-2xl">{copy.invalidTitle}</CardTitle>
            <CardDescription>{errorMessage}</CardDescription>
          </CardHeader>
          <CardContent className="flex justify-center py-6">
            <AlertCircle className="text-destructive h-16 w-16" />
          </CardContent>
          <CardFooter className="flex justify-center">
            <Button asChild>
              <Link href="/auth/signin">{copy.backToSignIn}</Link>
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
            <CardTitle className="text-2xl">{copy.activatedTitle}</CardTitle>
            <CardDescription>{copy.activatedDescription}</CardDescription>
          </CardHeader>
          <CardContent className="flex justify-center py-6">
            <CheckCircle2 className="text-success h-16 w-16" />
          </CardContent>
          <CardFooter className="flex justify-center">
            <p>{copy.redirectMessage}</p>
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
          <CardTitle className="text-2xl">{copy.formTitle}</CardTitle>
          <CardDescription>{copy.formSubtitle(userEmail)}</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="password">{copy.passwordLabel}</Label>
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
              <Label htmlFor="confirmPassword">
                {copy.confirmPasswordLabel}
              </Label>
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
              {isSubmitting ? copy.submittingLabel : copy.submitLabel}
            </Button>
          </form>
        </CardContent>
        <CardFooter className="flex justify-center">
          <p className="text-muted-foreground text-sm">
            {copy.alreadyHaveAccount}{" "}
            <Link href="/auth/signin" className="text-primary underline">
              {copy.signInLabel}
            </Link>
          </p>
        </CardFooter>
      </Card>
    </div>
  );
}
