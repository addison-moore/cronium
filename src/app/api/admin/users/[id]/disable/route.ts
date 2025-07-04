import { NextRequest, NextResponse } from "next/server";
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

    // Await params to get the id
    const { id } = await params;

    // Get the user to disable
    const user = await storage.getUser(id);

    if (!user) {
      return NextResponse.json({ message: "User not found" }, { status: 404 });
    }

    // Check if the user is already disabled
    if (user.status === UserStatus.DISABLED) {
      return NextResponse.json(
        { message: "User is already disabled" },
        { status: 400 },
      );
    }

    // Prevent disabling yourself
    if (id === session.user.id) {
      return NextResponse.json(
        { message: "You cannot disable your own account" },
        { status: 400 },
      );
    }

    // Disable the user
    const updatedUser = await storage.disableUser(id);

    return NextResponse.json(updatedUser);
  } catch (error) {
    console.error("Error disabling user:", error);
    return NextResponse.json(
      { message: "An error occurred while disabling the user" },
      { status: 500 },
    );
  }
}
