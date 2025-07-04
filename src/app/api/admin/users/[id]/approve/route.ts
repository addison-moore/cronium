import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { UserRole, UserStatus } from "@/shared/schema";
import { storage } from "@/server/storage";

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

    const { id } = await params;

    // Get the user
    const user = await storage.getUser(id);

    if (!user) {
      return NextResponse.json({ message: "User not found" }, { status: 404 });
    }

    // Check if the user is in pending status
    if (user.status !== UserStatus.PENDING) {
      return NextResponse.json(
        { message: "Can only approve users with PENDING status" },
        { status: 400 },
      );
    }

    // Update user status to ACTIVE
    await storage.updateUser(id, {
      status: UserStatus.ACTIVE,
      updatedAt: new Date(),
    });

    console.log(
      `User ${user.email ?? ""} approved by admin ${session.user.email ?? ""}`,
    );

    return NextResponse.json({ message: "User approved successfully" });
  } catch (error) {
    console.error("Error approving user:", error);
    return NextResponse.json(
      { message: "An error occurred while approving the user" },
      { status: 500 },
    );
  }
}
