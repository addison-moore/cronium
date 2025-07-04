import { NextRequest, NextResponse } from "next/server";
import { storage } from "@/server/storage";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

// PUT /api/admin/variables/[id] - Update a variable
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
    const body = await request.json();
    const { value, description } = body;

    if (!value) {
      return NextResponse.json({ error: "Value is required" }, { status: 400 });
    }

    // Get the variable to ensure it belongs to the user
    const variables = await storage.getUserVariables(session.user.id);
    const variable = variables.find((v) => v.id === variableId);

    if (!variable) {
      return NextResponse.json(
        { error: "Variable not found" },
        { status: 404 },
      );
    }

    const updatedVariable = await storage.setUserVariable(
      session.user.id,
      variable.key,
      value,
      description,
    );

    return NextResponse.json(updatedVariable);
  } catch (error) {
    console.error("Error updating user variable:", error);
    return NextResponse.json(
      { error: "Failed to update variable" },
      { status: 500 },
    );
  }
}

// DELETE /api/admin/variables/[id] - Delete a variable
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

    // Get the variable to ensure it belongs to the user
    const variables = await storage.getUserVariables(session.user.id);
    const variable = variables.find((v) => v.id === variableId);

    if (!variable) {
      return NextResponse.json(
        { error: "Variable not found" },
        { status: 404 },
      );
    }

    const deleted = await storage.deleteUserVariableByKey(
      session.user.id,
      variable.key,
    );

    if (!deleted) {
      return NextResponse.json(
        { error: "Failed to delete variable" },
        { status: 500 },
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting user variable:", error);
    return NextResponse.json(
      { error: "Failed to delete variable" },
      { status: 500 },
    );
  }
}
