import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { compare } from "bcrypt";
import { storage } from "@/server/storage";
import { UserStatus } from "@/shared/schema";

export async function POST(request: NextRequest) {
  try {
    const { username, password } = await request.json();

    if (!username || !password) {
      return NextResponse.json(
        { success: false, message: "Username and password are required" },
        { status: 400 },
      );
    }

    // Find user by username or email
    let user = await storage.getUserByUsername(username);
    if (!user) {
      user = await storage.getUserByEmail(username);
    }

    if (!user) {
      return NextResponse.json(
        { success: false, message: "Invalid username/email or password" },
        { status: 401 },
      );
    }

    // Check user status
    if (user.status === UserStatus.DISABLED) {
      return NextResponse.json(
        { success: false, message: "Account is disabled" },
        { status: 401 },
      );
    }

    if (user.status === UserStatus.PENDING) {
      return NextResponse.json(
        { success: false, message: "Account is pending approval" },
        { status: 401 },
      );
    }

    // Verify password
    const isValidPassword = await compare(password, user.password || "");

    if (!isValidPassword) {
      return NextResponse.json(
        { success: false, message: "Invalid username/email or password" },
        { status: 401 },
      );
    }

    // Update last login
    await storage.updateUser(user.id, { lastLogin: new Date() });

    // Return success with user data (without password)
    return NextResponse.json({
      success: true,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        status: user.status,
      },
    });
  } catch (error) {
    console.error("Login route error:", error);
    return NextResponse.json(
      { success: false, message: "Internal server error" },
      { status: 500 },
    );
  }
}
