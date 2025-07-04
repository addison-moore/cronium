import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { storage } from "@/server/storage";
import { authenticateApiRequest } from "@/lib/api-auth";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ key: string }> },
) {
  try {
    const { key } = await params;

    // Try API token authentication first, then session
    const apiAuth = await authenticateApiRequest(request);
    let userId: string;

    if (apiAuth.authenticated && apiAuth.userId) {
      userId = apiAuth.userId;
    } else {
      const session = await getServerSession(authOptions);
      if (!session?.user?.id) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
      userId = session.user.id;
    }

    const variable = await storage.getUserVariable(
      userId,
      decodeURIComponent(key),
    );

    if (!variable) {
      return NextResponse.json(
        { error: "Variable not found" },
        { status: 404 },
      );
    }

    return NextResponse.json({ variable });
  } catch (error) {
    console.error("Error fetching user variable:", error);
    return NextResponse.json(
      { error: "Failed to fetch variable" },
      { status: 500 },
    );
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ key: string }> },
) {
  try {
    const { key } = await params;

    // Try API token authentication first, then session
    const apiAuth = await authenticateApiRequest(request);
    let userId: string;

    if (apiAuth.authenticated && apiAuth.userId) {
      userId = apiAuth.userId;
    } else {
      const session = await getServerSession(authOptions);
      if (!session?.user?.id) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
      userId = session.user.id;
    }

    const { value, description } = await request.json();

    // Validation
    if (typeof value !== "string") {
      return NextResponse.json(
        { error: "Variable value must be a string" },
        { status: 400 },
      );
    }

    const decodedKey = decodeURIComponent(key);

    // Check if variable exists
    const existingVariable = await storage.getUserVariable(userId, decodedKey);
    if (!existingVariable) {
      return NextResponse.json(
        { error: "Variable not found" },
        { status: 404 },
      );
    }

    const updatedVariable = await storage.setUserVariable(
      userId,
      decodedKey,
      value,
      description?.trim() || existingVariable.description,
    );

    return NextResponse.json({ variable: updatedVariable });
  } catch (error) {
    console.error("Error updating user variable:", error);
    return NextResponse.json(
      { error: "Failed to update variable" },
      { status: 500 },
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ key: string }> },
) {
  try {
    const { key } = await params;

    // Try API token authentication first, then session
    const apiAuth = await authenticateApiRequest(request);
    let userId: string;

    if (apiAuth.authenticated && apiAuth.userId) {
      userId = apiAuth.userId;
    } else {
      const session = await getServerSession(authOptions);
      if (!session?.user?.id) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
      userId = session.user.id;
    }

    const decodedKey = decodeURIComponent(key);

    // Check if variable exists
    const existingVariable = await storage.getUserVariable(userId, decodedKey);
    if (!existingVariable) {
      return NextResponse.json(
        { error: "Variable not found" },
        { status: 404 },
      );
    }

    const deleted = await storage.deleteUserVariableByKey(userId, decodedKey);

    if (!deleted) {
      return NextResponse.json(
        { error: "Failed to delete variable" },
        { status: 500 },
      );
    }

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error) {
    console.error("Error deleting user variable:", error);
    return NextResponse.json(
      { error: "Failed to delete variable" },
      { status: 500 },
    );
  }
}
