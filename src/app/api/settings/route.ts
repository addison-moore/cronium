import { NextRequest, NextResponse } from "next/server";
import { storage } from "@/server/storage";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { z } from "zod";
import { UserRole } from "@/shared/schema";

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Get all settings
    const settingsRecords = await storage.getAllSettings();

    // Convert to object
    const settings = settingsRecords.reduce(
      (acc, setting) => {
        acc[setting.key] = setting.value;
        return acc;
      },
      {} as Record<string, any>,
    );

    // If not admin, filter out sensitive information
    if (session.user.role !== UserRole.ADMIN) {
      // Allow regular users to view non-sensitive settings only
      const publicSettings = {
        openRegistration: settings.openRegistration || false,
        smtpEnabled: settings.smtpEnabled || false,
        // Add any other non-sensitive settings here that should be visible to all users
      };
      return NextResponse.json(publicSettings);
    }

    // Admin gets full access to all settings
    return NextResponse.json(settings);
  } catch (error) {
    console.error("Error fetching settings:", error);
    return NextResponse.json(
      { error: "Failed to fetch settings" },
      { status: 500 },
    );
  }
}

const updateSettingsSchema = z.object({
  smtpServer: z.string().optional(),
  smtpPort: z.number().optional(),
  smtpFromAddress: z.string().optional(),
  smtpUser: z.string().optional(),
  smtpPassword: z.string().optional(),
  openRegistration: z.boolean().optional(),
});

export async function PUT(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Parse the request body
    const body = await req.json();

    // Only admins can update settings
    if (session.user.role !== UserRole.ADMIN) {
      return NextResponse.json(
        {
          error:
            "Unauthorized access. Admin privileges required for these settings.",
        },
        { status: 403 },
      );
    }

    const parsedBody = updateSettingsSchema.safeParse(body);

    if (!parsedBody.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsedBody.error.format() },
        { status: 400 },
      );
    }

    // Update each setting
    const updates = [];
    for (const [key, value] of Object.entries(parsedBody.data)) {
      if (value !== undefined) {
        // Convert all values to string for storage
        const stringValue =
          typeof value === "boolean" || typeof value === "number"
            ? String(value)
            : (value as string);
        updates.push(storage.upsertSetting(key, stringValue));
      }
    }

    await Promise.all(updates);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error updating settings:", error);
    return NextResponse.json(
      { error: "Failed to update settings" },
      { status: 500 },
    );
  }
}
