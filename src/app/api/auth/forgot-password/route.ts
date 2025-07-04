import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { storage } from "@/server/storage";
import { sendPasswordResetEmail } from "@/lib/email";
import { nanoid } from "nanoid";
import { UserStatus } from "@/shared/schema";

const forgotPasswordSchema = z.object({
  email: z.string().email("Please enter a valid email address"),
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email } = forgotPasswordSchema.parse(body);

    // Find user by email
    const user = await storage.getUserByEmail(email);

    // Always return success to prevent email enumeration attacks
    if (!user) {
      return NextResponse.json({
        success: true,
        message:
          "If an account with that email exists, we've sent a password reset link.",
      });
    }

    // Check if user is active
    if (user.status !== UserStatus.ACTIVE) {
      return NextResponse.json({
        success: true,
        message:
          "If an account with that email exists, we've sent a password reset link.",
      });
    }

    // Generate reset token (valid for 1 hour)
    const resetToken = nanoid(32);
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour from now

    // Save reset token to database
    await storage.createPasswordResetToken({
      userId: user.id,
      token: resetToken,
      expiresAt,
      used: false,
    });

    // Send password reset email (pass just the token, not the full URL)
    await sendPasswordResetEmail(email, resetToken);

    return NextResponse.json({
      success: true,
      message:
        "If an account with that email exists, we've sent a password reset link.",
    });
  } catch (error) {
    console.error("Forgot password error:", error);

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          success: false,
          message: error.errors[0]?.message ?? "Validation error",
        },
        { status: 400 },
      );
    }

    return NextResponse.json(
      { success: false, message: "An error occurred. Please try again." },
      { status: 500 },
    );
  }
}
