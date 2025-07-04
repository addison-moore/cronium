import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { UserRole, UserStatus } from "@/shared/schema";
import { storage } from "@/server/storage";

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
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

    // Get the user to enable
    const user = await storage.getUser(params.id);

    if (!user) {
      return NextResponse.json({ message: "User not found" }, { status: 404 });
    }

    // Check if the user is already active
    if (user.status === UserStatus.ACTIVE) {
      return NextResponse.json(
        { message: "User is already active" },
        { status: 400 },
      );
    }

    // Enable the user
    const updatedUser = await storage.updateUser(params.id, {
      status: UserStatus.ACTIVE,
      updatedAt: new Date(),
    });

    return NextResponse.json(updatedUser);
  } catch (error) {
    console.error("Error enabling user:", error);
    return NextResponse.json(
      { message: "An error occurred while enabling the user" },
      { status: 500 },
    );
  }
}
