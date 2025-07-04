import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/server/db";
import { roles } from "@/shared/schema";
import { eq } from "drizzle-orm";

export async function GET() {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.role || session.user.role !== "ADMIN") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const rolesList = await db.select().from(roles);

    return NextResponse.json(rolesList);
  } catch (error) {
    console.error("Error fetching roles:", error);
    return NextResponse.json(
      { error: "Failed to fetch roles" },
      { status: 500 },
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.role || session.user.role !== "ADMIN") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { roleId, permissions } = await request.json();

    if (!roleId || !permissions) {
      return NextResponse.json(
        { error: "Role ID and permissions are required" },
        { status: 400 },
      );
    }

    const [updatedRole] = await db
      .update(roles)
      .set({
        permissions,
        updatedAt: new Date(),
      })
      .where(eq(roles.id, roleId))
      .returning();

    if (!updatedRole) {
      return NextResponse.json({ error: "Role not found" }, { status: 404 });
    }

    return NextResponse.json(updatedRole);
  } catch (error) {
    console.error("Error updating role:", error);
    return NextResponse.json(
      { error: "Failed to update role" },
      { status: 500 },
    );
  }
}
