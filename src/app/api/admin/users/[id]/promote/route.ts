import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { UserRole } from "@/shared/schema";
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

    // Get the user to promote
    const { id } = await params;
    const user = await storage.getUser(id);

    if (!user) {
      return NextResponse.json({ message: "User not found" }, { status: 404 });
    }

    // Check if the user is already an admin
    if (user.role === UserRole.ADMIN) {
      return NextResponse.json(
        { message: "User is already an admin" },
        { status: 400 },
      );
    }

    // Update the user's role to admin
    const updatedUser = await storage.updateUser(id, {
      role: UserRole.ADMIN,
      updatedAt: new Date(),
    });

    return NextResponse.json(updatedUser);
  } catch (error) {
    console.error("Error promoting user:", error);
    return NextResponse.json(
      { message: "An error occurred while promoting the user" },
      { status: 500 },
    );
  }
}
