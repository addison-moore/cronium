import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { storage } from "@/server/storage";
import { encryptionService } from "@/lib/encryption-service";

const resetPasswordSchema = z.object({
  token: z.string().min(1, "Reset token is required"),
  password: z.string().min(8, "Password must be at least 8 characters long"),
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { token, password } = resetPasswordSchema.parse(body);

    // Validate reset token
    const resetToken = await storage.getPasswordResetToken(token);

    if (!resetToken) {
      return NextResponse.json(
        { success: false, message: "Invalid or expired reset token." },
        { status: 400 },
      );
    }

    // Get user
    const user = await storage.getUser(resetToken.userId);

    if (!user) {
      return NextResponse.json(
        { success: false, message: "User not found." },
        { status: 400 },
      );
    }

    // Hash the new password
    const hashedPassword = await encryptionService.hashPassword(password);

    // Update user password
    await storage.updateUser(user.id, {
      password: hashedPassword,
    });

    // Mark token as used
    await storage.markPasswordResetTokenAsUsed(token);

    // Clean up expired tokens
    await storage.deleteExpiredPasswordResetTokens();

    return NextResponse.json({
      success: true,
      message:
        "Password reset successfully. You can now sign in with your new password.",
    });
  } catch (error) {
    console.error("Reset password error:", error);

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
