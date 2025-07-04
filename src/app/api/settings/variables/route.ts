import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { storage } from "@/server/storage";

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

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { key, value, description } = await request.json();

    if (!key || typeof key !== "string" || !key.trim()) {
      return NextResponse.json(
        { error: "Variable key is required" },
        { status: 400 },
      );
    }

    if (typeof value !== "string") {
      return NextResponse.json(
        { error: "Variable value must be a string" },
        { status: 400 },
      );
    }

    const variable = await storage.createUserVariable({
      userId: session.user.id,
      key: key.trim(),
      value,
      description: description || null,
    });

    return NextResponse.json(variable, { status: 201 });
  } catch (error: any) {
    console.error("Error creating user variable:", error);

    // Handle unique constraint violation
    if (error.code === "23505" || error.message?.includes("duplicate key")) {
      return NextResponse.json(
        { error: "A variable with this key already exists" },
        { status: 409 },
      );
    }

    return NextResponse.json(
      { error: "Failed to create variable" },
      { status: 500 },
    );
  }
}
