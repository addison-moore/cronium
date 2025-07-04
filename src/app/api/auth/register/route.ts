import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { storage } from "@/server/storage";
import { nanoid } from "nanoid";
import { UserRole, UserStatus } from "@/shared/schema";
import { z } from "zod";

// Validation schema for registration
const registerSchema = z.object({
  username: z.string().min(3, "Username must be at least 3 characters long"),
  email: z.string().email("Invalid email address"),
  password: z.string().min(8, "Password must be at least 8 characters long"),
  role: z.nativeEnum(UserRole).default(UserRole.USER),
  status: z.nativeEnum(UserStatus).optional(),
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    // Validate request body
    const result = registerSchema.safeParse(body);
    if (!result.success) {
      return NextResponse.json(
        { message: "Validation failed", errors: result.error.flatten() },
        { status: 400 },
      );
    }

    const { username, email, password, role } = result.data;
    let { status } = result.data;

    // Check if username already exists
    const existingUsername = await storage.getUserByUsername(username);
    if (existingUsername) {
      return NextResponse.json(
        { message: "Username already taken" },
        { status: 409 },
      );
    }

    // Check if email already exists
    const existingEmail = await storage.getUserByEmail(email);
    if (existingEmail) {
      return NextResponse.json(
        { message: "Email already registered" },
        { status: 409 },
      );
    }

    // Check registration settings and determine user status (for non-admin users)
    if (role === UserRole.USER) {
      const allowRegistrationSetting =
        await storage.getSetting("allowRegistration");
      const requireAdminApprovalSetting = await storage.getSetting(
        "requireAdminApproval",
      );
      const inviteOnlySetting = await storage.getSetting("inviteOnly");

      const allowRegistration = allowRegistrationSetting?.value !== "false";
      const requireAdminApproval =
        requireAdminApprovalSetting?.value === "true";
      const inviteOnly = inviteOnlySetting?.value === "true";

      // Check if registration is allowed
      if (inviteOnly ?? !allowRegistration) {
        return NextResponse.json(
          { message: "Registration is currently closed" },
          { status: 403 },
        );
      }

      // Determine user status based on admin approval requirement
      if (requireAdminApproval) {
        status = UserStatus.PENDING;
      } else {
        status = UserStatus.ACTIVE;
      }
    } else {
      // Admin users are always active by default
      status = status ?? UserStatus.ACTIVE;
    }

    // Create user
    const user = await storage.createUser({
      id: nanoid(),
      username,
      email,
      password,
      role,
      status,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // Return user without password
    const { password: _, ...userWithoutPassword } = user;

    return NextResponse.json(userWithoutPassword, { status: 201 });
  } catch (error) {
    console.error("Registration error:", error);
    return NextResponse.json(
      { message: "An error occurred during registration" },
      { status: 500 },
    );
  }
}
