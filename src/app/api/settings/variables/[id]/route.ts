import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { storage } from "@/server/storage";

export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const variableId = parseInt(params.id);
    if (isNaN(variableId)) {
      return NextResponse.json(
        { error: "Invalid variable ID" },
        { status: 400 },
      );
    }

    const { value, description } = await request.json();

    if (typeof value !== "string") {
      return NextResponse.json(
        { error: "Variable value must be a string" },
        { status: 400 },
      );
    }

    const variable = await storage.updateUserVariable(
      variableId,
      session.user.id,
      {
        value,
        description: description || null,
      },
    );

    if (!variable) {
      return NextResponse.json(
        { error: "Variable not found or not owned by user" },
        { status: 404 },
      );
    }

    return NextResponse.json(variable);
  } catch (error: any) {
    console.error("Error updating user variable:", error);
    return NextResponse.json(
      { error: "Failed to update variable" },
      { status: 500 },
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const variableId = parseInt(params.id);
    if (isNaN(variableId)) {
      return NextResponse.json(
        { error: "Invalid variable ID" },
        { status: 400 },
      );
    }

    const success = await storage.deleteUserVariable(
      variableId,
      session.user.id,
    );

    if (!success) {
      return NextResponse.json(
        { error: "Variable not found or not owned by user" },
        { status: 404 },
      );
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("Error deleting user variable:", error);
    return NextResponse.json(
      { error: "Failed to delete variable" },
      { status: 500 },
    );
  }
}
