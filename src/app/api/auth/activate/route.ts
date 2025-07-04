import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { storage } from "@/server/storage";
import { UserStatus } from "@/shared/schema";
import bcrypt from "bcrypt";
import { z } from "zod";

// Validation schema for account activation
const activationSchema = z.object({
  token: z.string().min(1, "Token is required"),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

export async function POST(req: NextRequest) {
  try {
    // Parse and validate request body
    const body = await req.json();

    const result = activationSchema.safeParse(body);
    if (!result.success) {
      return NextResponse.json(
        { message: "Validation failed", errors: result.error.flatten() },
        { status: 400 },
      );
    }

    const { token, password } = result.data;

    // Find user with this invite token
    const user = await storage.getUserByInviteToken(token);

    if (!user) {
      return NextResponse.json(
        { message: "Invalid invitation token" },
        { status: 404 },
      );
    }

    // Check if token is expired
    if (user.inviteExpiry && new Date(user.inviteExpiry) < new Date()) {
      return NextResponse.json(
        { message: "Invitation token has expired" },
        { status: 400 },
      );
    }

    // Check if user is in INVITED status
    if (user.status !== UserStatus.INVITED) {
      return NextResponse.json(
        { message: "This account has already been activated" },
        { status: 400 },
      );
    }

    // Hash the password
    const passwordHash = await bcrypt.hash(password, 10);

    // Update user status to ACTIVE and save password
    await storage.updateUser(user.id, {
      status: UserStatus.ACTIVE,
      password: passwordHash,
      inviteToken: null,
      inviteExpiry: null,
      updatedAt: new Date(),
    });

    return NextResponse.json({
      message: "Account activated successfully",
    });
  } catch (error) {
    console.error("Error activating account:", error);
    return NextResponse.json(
      { message: "An error occurred while activating your account" },
      { status: 500 },
    );
  }
}
