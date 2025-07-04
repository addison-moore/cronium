import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/server/db";
import { toolCredentials } from "@/shared/schema";
import { eq, and } from "drizzle-orm";
import { encryptionService } from "@/lib/encryption-service";
import { z } from "zod";

const updateToolSchema = z.object({
  name: z.string().min(1, "Name is required").optional(),
  credentials: z.record(z.string(), z.any()).optional(),
  isActive: z.boolean().optional(),
});

export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const toolId = parseInt(params.id);
    if (isNaN(toolId)) {
      return NextResponse.json({ error: "Invalid tool ID" }, { status: 400 });
    }

    const body = await request.json();
    const validatedData = updateToolSchema.parse(body);

    const updateData: any = {};

    if (validatedData.name) {
      updateData.name = validatedData.name;
    }

    if (validatedData.credentials) {
      updateData.credentials = encryptionService.encrypt(
        JSON.stringify(validatedData.credentials),
      );
    }

    if (validatedData.isActive !== undefined) {
      updateData.isActive = validatedData.isActive;
    }

    const [updatedTool] = await db
      .update(toolCredentials)
      .set(updateData)
      .where(and(eq(toolCredentials.id, toolId), eq(toolCredentials.userId, session.user.id)))
      .returning();

    if (!updatedTool) {
      return NextResponse.json({ error: "Tool not found" }, { status: 404 });
    }

    return NextResponse.json({
      ...updatedTool,
      credentials:
        validatedData.credentials ||
        JSON.parse(encryptionService.decrypt(updatedTool.credentials)),
    });
  } catch (error) {
    console.error("Error updating tool:", error);
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid data", details: error.errors },
        { status: 400 },
      );
    }
    return NextResponse.json(
      { error: "Failed to update tool" },
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

    const toolId = parseInt(params.id);
    if (isNaN(toolId)) {
      return NextResponse.json({ error: "Invalid tool ID" }, { status: 400 });
    }

    const [deletedTool] = await db
      .delete(toolCredentials)
      .where(and(eq(toolCredentials.id, toolId), eq(toolCredentials.userId, session.user.id)))
      .returning();

    if (!deletedTool) {
      return NextResponse.json({ error: "Tool not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting tool:", error);
    return NextResponse.json(
      { error: "Failed to delete tool" },
      { status: 500 },
    );
  }
}
