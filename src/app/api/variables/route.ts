import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { storage } from "@/server/storage";
import { authenticateApiRequest } from "@/lib/api-auth";

export async function GET(request: NextRequest) {
  try {
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

    const variables = await storage.getUserVariables(userId);

    return NextResponse.json({
      variables,
      pagination: {
        page: 1,
        limit: variables.length,
        total: variables.length,
        pages: 1,
      },
    });
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

    const { key, value, description } = await request.json();

    // Validation
    if (!key || typeof key !== "string" || !key.trim()) {
      return NextResponse.json(
        { error: "Variable key is required and must be a non-empty string" },
        { status: 400 },
      );
    }

    if (typeof value !== "string") {
      return NextResponse.json(
        { error: "Variable value must be a string" },
        { status: 400 },
      );
    }

    // Check if variable already exists
    const existingVariable = await storage.getUserVariable(userId, key.trim());
    if (existingVariable) {
      return NextResponse.json(
        { error: "Variable with this key already exists. Use PUT to update." },
        { status: 409 },
      );
    }

    const variable = await storage.setUserVariable(
      userId,
      key.trim(),
      value,
      description?.trim() || undefined,
    );

    return NextResponse.json({ variable }, { status: 201 });
  } catch (error) {
    console.error("Error creating user variable:", error);
    return NextResponse.json(
      { error: "Failed to create variable" },
      { status: 500 },
    );
  }
}
