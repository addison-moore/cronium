import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { storage } from "@/server/storage";
import { UserRole, UserStatus } from "@/shared/schema";
import { z } from "zod";
import { nanoid } from "nanoid";
import { sendInvitationEmail } from "@/lib/email";

// Validation schema for user invitation
const inviteSchema = z.object({
  email: z.string().email("Please enter a valid email address"),
  username: z.string().min(3, "Username must be at least 3 characters"),
  role: z.nativeEnum(UserRole),
});

// POST: Invite a new user
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

    // Get request body and validate
    const body = await req.json();
    const result = inviteSchema.safeParse(body);

    if (!result.success) {
      return NextResponse.json(
        { message: "Validation failed", errors: result.error.flatten() },
        { status: 400 },
      );
    }

    const { email, username, role } = result.data;

    // Check if user with this email already exists
    const existingUserByEmail = await storage.getUserByEmail(email);
    if (existingUserByEmail) {
      return NextResponse.json(
        { message: "A user with this email already exists" },
        { status: 400 },
      );
    }

    // Check if user with this username already exists
    const existingUserByUsername = await storage.getUserByUsername(username);
    if (existingUserByUsername) {
      return NextResponse.json(
        { message: "A user with this username already exists" },
        { status: 400 },
      );
    }

    // Generate a unique token for the invitation
    const inviteToken = nanoid(32);

    // Set expiry date (48 hours from now)
    const inviteExpiry = new Date();
    inviteExpiry.setHours(inviteExpiry.getHours() + 48);

    // Create the user in INVITED status
    const newUser = await storage.createUser({
      id: nanoid(21), // Generate a unique ID for the user
      username,
      email,
      role,
      status: UserStatus.INVITED,
      inviteToken,
      inviteExpiry,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // Send invitation email with the token link
    await sendInvitationEmail(email, inviteToken);
    console.log(`Invitation created for ${email} with token ${inviteToken}`);

    // Return success response without exposing the token
    return NextResponse.json({
      message: "User invited successfully",
      user: {
        id: newUser.id,
        username: newUser.username,
        email: newUser.email,
        role: newUser.role,
        status: newUser.status,
        inviteExpiry,
      },
    });
  } catch (error) {
    console.error("Error inviting user:", error);
    return NextResponse.json(
      { message: "An error occurred inviting the user" },
      { status: 500 },
    );
  }
}
