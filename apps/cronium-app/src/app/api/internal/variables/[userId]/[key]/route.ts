import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { db } from "@/server/db";
import { userVariables } from "@/shared/schema";
import { and, eq } from "drizzle-orm";
import { verifyInternalKey } from "@/lib/internal-auth";
import {
  encryptVariableValue,
  decryptVariableValue,
} from "@/lib/security/variable-secret";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string; key: string }> },
) {
  try {
    // Timing-safe internal-key check (HI-10)
    if (!verifyInternalKey(request)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { userId, key } = await params;

    // Get variable
    const variable = await db
      .select({
        key: userVariables.key,
        value: userVariables.value,
        updatedAt: userVariables.updatedAt,
      })
      .from(userVariables)
      .where(and(eq(userVariables.userId, userId), eq(userVariables.key, key)))
      .limit(1);

    if (!variable || variable.length === 0) {
      return NextResponse.json(
        { error: "Variable not found" },
        { status: 404 },
      );
    }

    const varData = variable[0];
    if (!varData) {
      return NextResponse.json(
        { error: "Variable not found" },
        { status: 404 },
      );
    }

    // Decrypt at the execution-resolution boundary (the runtime needs the
    // plaintext to satisfy cronium.getVariable()).
    return NextResponse.json({
      key: varData.key,
      value: decryptVariableValue(varData.value, userId, varData.key),
      updatedAt: varData.updatedAt,
    });
  } catch (error) {
    console.error("Error fetching variable:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string; key: string }> },
) {
  try {
    // Timing-safe internal-key check (HI-10)
    if (!verifyInternalKey(request)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { userId, key } = await params;
    const body = (await request.json()) as { value: string };

    // Encrypt at rest (cronium.setVariable() from a running script).
    const storedValue = encryptVariableValue(body.value, userId, key);

    // Insert or update variable
    await db
      .insert(userVariables)
      .values({
        userId,
        key,
        value: storedValue,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [userVariables.userId, userVariables.key],
        set: {
          value: storedValue,
          updatedAt: new Date(),
        },
      });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error updating variable:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
