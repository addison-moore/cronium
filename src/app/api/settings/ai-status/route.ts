import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { storage } from "@/server/storage";

export async function GET(req: NextRequest) {
  try {
    // Check if user is authenticated
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    // Get AI settings from the database
    const aiEnabledSetting = await storage.getSetting("aiEnabled");
    const isEnabled = aiEnabledSetting?.value === "true";

    return NextResponse.json({ enabled: isEnabled });
  } catch (error) {
    console.error("Error checking AI status:", error);
    return NextResponse.json(
      { message: "Failed to check AI status" },
      { status: 500 },
    );
  }
}
