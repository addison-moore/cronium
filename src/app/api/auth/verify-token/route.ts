import { NextRequest, NextResponse } from "next/server";
import { storage } from "@/server/storage";
import { UserStatus } from "@/shared/schema";

export async function GET(req: NextRequest) {
  try {
    // Extract token from query string
    const url = new URL(req.url);
    const token = url.searchParams.get("token");

    if (!token) {
      return NextResponse.json(
        { message: "Invitation token is required" },
        { status: 400 },
      );
    }

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

    // Return user email
    return NextResponse.json({
      message: "Token verified successfully",
      email: user.email,
    });
  } catch (error) {
    console.error("Error verifying invitation token:", error);
    return NextResponse.json(
      { message: "An error occurred while verifying the invitation token" },
      { status: 500 },
    );
  }
}
