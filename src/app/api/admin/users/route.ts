import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { UserRole, UserStatus } from "@/shared/schema";
import { storage } from "@/server/storage";
import { z } from "zod";
import crypto from "crypto";
import { nanoid } from "nanoid";
import { sendInvitationEmail } from "@/lib/email";

// Validation schema for inviting a new user
const inviteUserSchema = z.object({
  email: z.string().email({ message: "Please enter a valid email address" }),
  role: z.nativeEnum(UserRole),
});

export async function GET(req: NextRequest) {
  try {
    // Check if the user is authenticated and is an admin
    const session = await getServerSession(authOptions);

    if (!session || !session.user) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    if (session.user.role !== UserRole.ADMIN) {
      return NextResponse.json(
        { message: "Forbidden: Admin access required" },
        { status: 403 },
      );
    }

    // Get all users
    const users = await storage.getAllUsers();

    return NextResponse.json(users);
  } catch (error) {
    console.error("Error fetching users:", error);
    return NextResponse.json(
      { message: "An error occurred while fetching users" },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    // Check if the user is authenticated and is an admin
    const session = await getServerSession(authOptions);

    if (!session || !session.user) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    if (session.user.role !== UserRole.ADMIN) {
      return NextResponse.json(
        { message: "Forbidden: Admin access required" },
        { status: 403 },
      );
    }

    // Parse and validate the request body
    const body = await req.json();
    const validatedData = inviteUserSchema.parse(body);

    // Check if user with this email already exists
    const existingUser = await storage.getUserByEmail(validatedData.email);

    if (existingUser) {
      return NextResponse.json(
        { message: "A user with this email already exists" },
        { status: 400 },
      );
    }

    // Generate a random id for the new user
    const userId = crypto.randomUUID();

    // Generate invite token and set expiry date (48 hours from now)
    const inviteToken = nanoid(32);
    const inviteExpiry = new Date();
    inviteExpiry.setHours(inviteExpiry.getHours() + 48);

    // Create the new user with invited status
    const newUser = await storage.createUser({
      id: userId,
      email: validatedData.email,
      role: validatedData.role,
      status: UserStatus.INVITED,
      inviteToken,
      inviteExpiry,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // Send invitation email
    await sendInvitationEmail(validatedData.email, inviteToken);
    console.log(`Invitation email sent to ${validatedData.email}`);

    return NextResponse.json(newUser, { status: 201 });
  } catch (error) {
    console.error("Error inviting user:", error);

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { message: "Invalid user data", errors: error.errors },
        { status: 400 },
      );
    }

    return NextResponse.json(
      { message: "An error occurred while inviting the user" },
      { status: 500 },
    );
  }
}
