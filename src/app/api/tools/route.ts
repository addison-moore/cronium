import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/server/db";
import { toolCredentials, ToolType } from "@/shared/schema";
import { eq } from "drizzle-orm";
import { encryptionService } from "@/lib/encryption-service";
import { z } from "zod";

const createToolSchema = z.object({
  name: z.string().min(1, "Name is required"),
  type: z.nativeEnum(ToolType),
  credentials: z.record(z.string(), z.any()),
});

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userTools = await db
      .select()
      .from(toolCredentials)
      .where(eq(toolCredentials.userId, session.user.id));

    // Decrypt credentials for display
    const decryptedTools = userTools.map((tool) => ({
      ...tool,
      credentials: JSON.parse(encryptionService.decrypt(tool.credentials)),
    }));

    return NextResponse.json(decryptedTools);
  } catch (error) {
    console.error("Error fetching tools:", error);
    return NextResponse.json(
      { error: "Failed to fetch tools" },
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

    const body = await request.json();
    const validatedData = createToolSchema.parse(body);

    // Encrypt credentials before storing
    const encryptedCredentials = encryptionService.encrypt(
      JSON.stringify(validatedData.credentials),
    );

    const [newTool] = await db
      .insert(toolCredentials)
      .values({
        userId: session.user.id,
        name: validatedData.name,
        type: validatedData.type,
        credentials: encryptedCredentials,
      })
      .returning();

    return NextResponse.json(
      {
        ...newTool,
        credentials: validatedData.credentials,
      },
      { status: 201 },
    );
  } catch (error) {
    console.error("Error creating tool:", error);
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid data", details: error.errors },
        { status: 400 },
      );
    }
    return NextResponse.json(
      { error: "Failed to create tool" },
      { status: 500 },
    );
  }
}
