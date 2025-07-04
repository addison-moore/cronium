import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { UserRole, UserStatus, type LogStatus } from "@/shared/schema";
import { storage } from "@/server/storage";
import { z } from "zod";

// Validation schema for updating a user
const updateUserSchema = z.object({
  username: z.string().optional().nullable(),
  firstName: z.string().optional().nullable(),
  lastName: z.string().optional().nullable(),
  email: z.string().email({ message: "Please enter a valid email address" }),
});

// Validation schema for role/status updates
const userActionSchema = z.object({
  role: z.nativeEnum(UserRole).optional(),
  status: z.nativeEnum(UserStatus).optional(),
});

export async function GET(
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

    // Get related stats and data
    const scripts = await storage.getAllEvents(id);
    const servers = await storage.getAllServers(id);

    // Get recent scripts (limited to 5)
    const recentScripts = scripts.slice(0, 5).map((script) => ({
      id: script.id,
      name: script.name,
      type: script.type,
      status: script.status,
      createdAt: script.createdAt.toISOString(),
    }));

    // Get logs for this user (we'll need to implement this)
    // For now, we'll return an empty array
    const recentLogs: {
      id: number;
      eventId: number;
      eventName: string;
      status: LogStatus;
      startTime: Date;
      duration: number | null;
    }[] = [];

    // Combine everything
    const userData = {
      ...user,
      scriptCount: scripts.length,
      serverCount: servers.length,
      recentScripts,
      recentLogs,
    };

    return NextResponse.json(userData);
  } catch (error) {
    console.error("Error fetching user data:", error);
    return NextResponse.json(
      { message: "An error occurred while fetching user data" },
      { status: 500 },
    );
  }
}

export async function PATCH(
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

    // Check if the user exists
    const existingUser = await storage.getUser(id);

    if (!existingUser) {
      return NextResponse.json({ message: "User not found" }, { status: 404 });
    }

    // Parse and validate the request body
    const body = await req.json();
    const validatedData = updateUserSchema.parse(body);

    // Check if email is being changed and if so, ensure it's not already in use
    if (validatedData.email !== existingUser.email) {
      const userWithEmail = await storage.getUserByEmail(validatedData.email);
      if (userWithEmail && userWithEmail.id !== id) {
        return NextResponse.json(
          { message: "Email is already in use by another user" },
          { status: 400 },
        );
      }
    }

    // Update the user
    const updatedUser = await storage.updateUser(id, {
      ...validatedData,
      updatedAt: new Date(),
    });

    return NextResponse.json(updatedUser);
  } catch (error) {
    console.error("Error updating user:", error);

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { message: "Invalid user data", errors: error.errors },
        { status: 400 },
      );
    }

    return NextResponse.json(
      { message: "An error occurred while updating the user" },
      { status: 500 },
    );
  }
}

export async function PUT(
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

    // Check if the user exists
    const existingUser = await storage.getUser(id);

    if (!existingUser) {
      return NextResponse.json({ message: "User not found" }, { status: 404 });
    }

    // Parse and validate the request body
    const body = await req.json();
    const validatedData = userActionSchema.parse(body);

    // Update the user with the new role or status
    const updatedUser = await storage.updateUser(id, {
      ...validatedData,
      updatedAt: new Date(),
    });

    return NextResponse.json(updatedUser);
  } catch (error) {
    console.error("Error updating user:", error);

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { message: "Invalid user data", errors: error.errors },
        { status: 400 },
      );
    }

    return NextResponse.json(
      { message: "An error occurred while updating the user" },
      { status: 500 },
    );
  }
}

export async function DELETE(
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

    // Check if the user exists
    const existingUser = await storage.getUser(id);

    if (!existingUser) {
      return NextResponse.json({ message: "User not found" }, { status: 404 });
    }

    // Prevent deleting yourself
    if (id === session.user.id) {
      return NextResponse.json(
        { message: "You cannot delete your own account" },
        { status: 400 },
      );
    }

    // Delete the user
    await storage.deleteUser(id);

    return NextResponse.json({ message: "User deleted successfully" });
  } catch (error) {
    console.error("Error deleting user:", error);
    return NextResponse.json(
      { message: "An error occurred while deleting the user" },
      { status: 500 },
    );
  }
}
