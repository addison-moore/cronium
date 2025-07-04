import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { UserRole } from "@/shared/schema";
import { storage } from "@/server/storage";
import { z } from "zod";

// Validation schema for settings
const settingsUpdateSchema = z.object({
  settings: z.array(
    z.object({
      key: z.string(),
      value: z.any(),
    }),
  ),
});

export async function GET(req: NextRequest) {
  try {
    // Check if the user is authenticated and is an admin
    const session = await getServerSession(authOptions);

    if (!session || !session.user) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    if (session.user.role !== UserRole.ADMIN) {
      return NextResponse.json(
        { message: "Forbidden: Admin access required" },
        { status: 403 },
      );
    }

    // Get all settings
    const settings = await storage.getAllSettings();

    // Transform settings array to an object for easier consumption by the client
    const settingsObject = settings.reduce(
      (acc, setting) => {
        // Try to parse the value as JSON, if it fails just use the string
        try {
          acc[setting.key] = JSON.parse(setting.value);
        } catch (e) {
          acc[setting.key] = setting.value;
        }
        return acc;
      },
      {} as Record<string, any>,
    );

    return NextResponse.json(settingsObject);
  } catch (error) {
    console.error("Error fetching settings:", error);
    return NextResponse.json(
      { message: "An error occurred while fetching settings" },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    // Check if the user is authenticated and is an admin
    const session = await getServerSession(authOptions);

    if (!session || !session.user) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    if (session.user.role !== UserRole.ADMIN) {
      return NextResponse.json(
        { message: "Forbidden: Admin access required" },
        { status: 403 },
      );
    }

    // Parse and validate the request body
    const body = await req.json();
    const validatedData = settingsUpdateSchema.parse(body);

    // Update each setting
    for (const { key, value } of validatedData.settings) {
      await storage.upsertSetting(key, value);
    }

    return NextResponse.json({ message: "Settings updated successfully" });
  } catch (error) {
    console.error("Error updating settings:", error);

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { message: "Invalid settings data", errors: error.errors },
        { status: 400 },
      );
    }

    return NextResponse.json(
      { message: "An error occurred while updating settings" },
      { status: 500 },
    );
  }
}
