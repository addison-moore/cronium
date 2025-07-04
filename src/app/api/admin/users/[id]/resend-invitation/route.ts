import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { UserRole, UserStatus } from "@/shared/schema";
import { storage } from "@/server/storage";
import { sendInvitationEmail } from "@/lib/email";
import { nanoid } from "nanoid";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
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

    // Await params to fix Next.js warning
    const { id } = await params;

    // Get the user
    const user = await storage.getUser(id);

    if (!user) {
      return NextResponse.json({ message: "User not found" }, { status: 404 });
    }

    // Check if the user is in invited status
    if (user.status !== UserStatus.INVITED) {
      return NextResponse.json(
        { message: "Can only resend invitations to invited users" },
        { status: 400 },
      );
    }

    // Always generate a new invitation token and expiry when resending
    const inviteToken = nanoid(32);
    const inviteExpiry = new Date();
    inviteExpiry.setHours(inviteExpiry.getHours() + 48);

    // Update the user with the new token and expiry
    await storage.updateUser(id, {
      inviteToken,
      inviteExpiry,
      updatedAt: new Date(),
    });

    // Send invitation email with the new token
    if (user.email) {
      await sendInvitationEmail(user.email, inviteToken);
      console.log(
        `New invitation token generated for user ${id}: ${inviteToken.substring(0, 8)}...`,
      );
    }

    console.log(`Invitation email has been sent to ${user.email}`);

    return NextResponse.json({ message: "Invitation resent successfully" });
  } catch (error) {
    console.error("Error resending invitation:", error);
    return NextResponse.json(
      { message: "An error occurred while resending the invitation" },
      { status: 500 },
    );
  }
}
