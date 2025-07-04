import { NextRequest, NextResponse } from "next/server";
import { storage } from "@/server/storage";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

// Helper function to verify token ownership
async function verifyTokenOwnership(tokenId: number, userId: string) {
  const token = await storage.getApiToken(tokenId);

  if (!token) {
    return { success: false, error: "Token not found" };
  }

  if (token.userId !== userId) {
    return { success: false, error: "Unauthorized" };
  }

  return { success: true, token };
}

// PUT /api/tokens/[id] - Revoke a token
export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const session = await getServerSession(authOptions);

    if (!session || !session.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = session.user.id;
    const tokenId = parseInt(params.id);

    if (isNaN(tokenId)) {
      return NextResponse.json({ error: "Invalid token ID" }, { status: 400 });
    }

    // Verify token belongs to the user
    const verificationResult = await verifyTokenOwnership(tokenId, userId);

    if (!verificationResult.success) {
      return NextResponse.json(
        { error: verificationResult.error },
        { status: verificationResult.error === "Token not found" ? 404 : 403 },
      );
    }

    // Revoke the token (set status to REVOKED)
    const updatedToken = await storage.revokeApiToken(tokenId);

    // Remove the actual token from the response for security
    const { token, ...sanitizedToken } = updatedToken;

    return NextResponse.json(sanitizedToken);
  } catch (error) {
    console.error("Error revoking token:", error);
    return NextResponse.json(
      { error: "Failed to revoke token" },
      { status: 500 },
    );
  }
}

// DELETE /api/tokens/[id] - Delete a token
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const session = await getServerSession(authOptions);

    if (!session || !session.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = session.user.id;
    const tokenId = parseInt(params.id);

    if (isNaN(tokenId)) {
      return NextResponse.json({ error: "Invalid token ID" }, { status: 400 });
    }

    // Verify token belongs to the user
    const verificationResult = await verifyTokenOwnership(tokenId, userId);

    if (!verificationResult.success) {
      return NextResponse.json(
        { error: verificationResult.error },
        { status: verificationResult.error === "Token not found" ? 404 : 403 },
      );
    }

    // Delete the token
    await storage.deleteApiToken(tokenId);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting token:", error);
    return NextResponse.json(
      { error: "Failed to delete token" },
      { status: 500 },
    );
  }
}
