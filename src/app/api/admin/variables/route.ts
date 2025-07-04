import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { storage } from "@/server/storage";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

// GET /api/admin/variables - Get all user variables
export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const variables = await storage.getUserVariables(session.user.id);

    return NextResponse.json(variables);
  } catch (error) {
    console.error("Error fetching user variables:", error);
    return NextResponse.json(
      { error: "Failed to fetch variables" },
      { status: 500 },
    );
  }
}

// POST /api/admin/variables - Create a new variable
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { key, value, description } = body;

    if (!key || !value) {
      return NextResponse.json(
        { error: "Key and value are required" },
        { status: 400 },
      );
    }

    // Check if variable with this key already exists
    const existingVariable = await storage.getUserVariable(
      session.user.id,
      key,
    );
    if (existingVariable) {
      return NextResponse.json(
        { error: "A variable with this key already exists" },
        { status: 409 },
      );
    }

    const newVariable = await storage.setUserVariable(
      session.user.id,
      key,
      value,
      description,
    );

    return NextResponse.json(newVariable, { status: 201 });
  } catch (error) {
    console.error("Error creating user variable:", error);
    return NextResponse.json(
      { error: "Failed to create variable" },
      { status: 500 },
    );
  }
}
