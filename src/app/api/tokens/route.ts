import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { storage } from "@/server/storage";
import { nanoid } from "nanoid";
import { TokenStatus } from "@/shared/schema";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

// GET /api/tokens - Get all tokens for the current user
export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session || !session.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = session.user.id;
    const tokens = await storage.getUserApiTokens(userId);

    // Remove the actual token from the response for security
    const sanitizedTokens = tokens.map((token) => {
      const { token: _, ...rest } = token;
      return rest;
    });

    return NextResponse.json(sanitizedTokens);
  } catch (error) {
    console.error("Error fetching tokens:", error);
    return NextResponse.json(
      { error: "Failed to fetch tokens" },
      { status: 500 },
    );
  }
}

// POST /api/tokens - Create a new token
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session || !session.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = session.user.id;
    const body = await request.json();

    if (!body.name) {
      return NextResponse.json(
        { error: "Token name is required" },
        { status: 400 },
      );
    }

    // Generate a secure token
    const token = nanoid(32);

    // Store the token in the database
    const apiToken = await storage.createApiToken({
      userId,
      name: body.name,
      token,
      status: TokenStatus.ACTIVE,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // Return the token once (it won't be retrievable after this)
    return NextResponse.json({
      ...apiToken,
      displayToken: token, // Only returned once
    });
  } catch (error) {
    console.error("Error creating token:", error);
    return NextResponse.json(
      { error: "Failed to create token" },
      { status: 500 },
    );
  }
}
