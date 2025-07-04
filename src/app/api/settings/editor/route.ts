import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { storage } from "@/server/storage";
import { db } from "@/server/db";
import { userSettings } from "@/shared/schema";
import { eq } from "drizzle-orm";

interface EditorSettings {
  fontSize: number;
  theme: string;
  wordWrap: boolean;
  minimap: boolean;
  lineNumbers: boolean;
}

const DEFAULT_EDITOR_SETTINGS: EditorSettings = {
  fontSize: 14,
  theme: "vs-dark",
  wordWrap: true,
  minimap: false,
  lineNumbers: true,
};

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const user = await storage.getUserByEmail(session.user.email);
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Get user settings
    const settings = await db
      .select()
      .from(userSettings)
      .where(eq(userSettings.userId, user.id))
      .limit(1);

    const userSetting = settings[0];
    let editorSettings = DEFAULT_EDITOR_SETTINGS;

    if (userSetting?.editorSettings) {
      try {
        editorSettings = JSON.parse(userSetting.editorSettings);
      } catch (error) {
        console.error("Failed to parse editor settings:", error);
      }
    }

    return NextResponse.json(editorSettings);
  } catch (error) {
    console.error("Error fetching editor settings:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const user = await storage.getUserByEmail(session.user.email);
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const editorSettings: EditorSettings = await request.json();

    // Validate the settings
    if (
      typeof editorSettings.fontSize !== "number" ||
      editorSettings.fontSize < 10 ||
      editorSettings.fontSize > 24
    ) {
      return NextResponse.json({ error: "Invalid font size" }, { status: 400 });
    }

    const validThemes = ["vs-dark", "vs-light", "hc-black", "hc-light"];
    if (!validThemes.includes(editorSettings.theme)) {
      return NextResponse.json({ error: "Invalid theme" }, { status: 400 });
    }

    // Check if user settings exist
    const existingSettings = await db
      .select()
      .from(userSettings)
      .where(eq(userSettings.userId, user.id))
      .limit(1);

    const settingsJson = JSON.stringify(editorSettings);

    if (existingSettings.length > 0) {
      // Update existing settings
      await db
        .update(userSettings)
        .set({
          editorSettings: settingsJson,
          updatedAt: new Date(),
        })
        .where(eq(userSettings.userId, user.id));
    } else {
      // Create new settings
      await db.insert(userSettings).values({
        userId: user.id,
        editorSettings: settingsJson,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error saving editor settings:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
