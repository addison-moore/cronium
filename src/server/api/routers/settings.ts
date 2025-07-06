import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import { TRPCError } from "@trpc/server";
import { storage } from "@/server/storage";
import { db } from "@/server/db";
import { userSettings } from "@/shared/schema";
import { eq } from "drizzle-orm";

// Define editor settings type for type safety
type EditorSettings = {
  fontSize: number;
  theme: "vs-dark" | "vs-light" | "hc-black" | "hc-light";
  wordWrap: boolean;
  minimap: boolean;
  lineNumbers: boolean;
};

// Type guard for editor settings validation
function isValidEditorSettings(obj: unknown): obj is EditorSettings {
  return (
    typeof obj === "object" &&
    obj !== null &&
    "fontSize" in obj &&
    "theme" in obj &&
    "wordWrap" in obj &&
    "minimap" in obj &&
    "lineNumbers" in obj &&
    typeof (obj as { fontSize: unknown }).fontSize === "number" &&
    typeof (obj as { theme: unknown }).theme === "string" &&
    ["vs-dark", "vs-light", "hc-black", "hc-light"].includes(
      (obj as { theme: string }).theme,
    ) &&
    typeof (obj as { wordWrap: unknown }).wordWrap === "boolean" &&
    typeof (obj as { minimap: unknown }).minimap === "boolean" &&
    typeof (obj as { lineNumbers: unknown }).lineNumbers === "boolean"
  );
}

// Schemas
const editorSettingsSchema = z.object({
  fontSize: z.number().min(10).max(24),
  theme: z.enum(["vs-dark", "vs-light", "hc-black", "hc-light"]),
  wordWrap: z.boolean(),
  minimap: z.boolean(),
  lineNumbers: z.boolean(),
});

const DEFAULT_EDITOR_SETTINGS: EditorSettings = {
  fontSize: 14,
  theme: "vs-dark",
  wordWrap: true,
  minimap: false,
  lineNumbers: true,
};

export const settingsRouter = createTRPCRouter({
  // Get user editor settings
  getEditorSettings: protectedProcedure.query(async ({ ctx }) => {
    try {
      // Type-safe access to user email
      const userEmail = ctx.session?.user?.email;
      if (!userEmail) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "User email not found in session",
        });
      }

      const user = await storage.getUserByEmail(userEmail);
      if (!user) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "User not found",
        });
      }

      // Get user settings
      const settings = await db
        .select()
        .from(userSettings)
        .where(eq(userSettings.userId, user.id))
        .limit(1);

      const userSetting = settings[0];
      let editorSettings: EditorSettings = DEFAULT_EDITOR_SETTINGS;

      if (userSetting?.editorSettings) {
        try {
          const parsed: unknown = JSON.parse(userSetting.editorSettings);
          if (isValidEditorSettings(parsed)) {
            editorSettings = parsed;
          } else {
            console.warn("Invalid editor settings format, using defaults");
          }
        } catch (error) {
          console.error("Failed to parse editor settings:", error);
        }
      }

      return editorSettings;
    } catch (error) {
      if (error instanceof TRPCError) {
        throw error;
      }
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Failed to fetch editor settings",
        cause: error instanceof Error ? error : new Error(String(error)),
      });
    }
  }),

  // Update user editor settings
  updateEditorSettings: protectedProcedure
    .input(editorSettingsSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        // Type-safe access to user email
        const userEmail = ctx.session?.user?.email;
        if (!userEmail) {
          throw new TRPCError({
            code: "UNAUTHORIZED",
            message: "User email not found in session",
          });
        }

        const user = await storage.getUserByEmail(userEmail);
        if (!user) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "User not found",
          });
        }

        // Check if user settings exist
        const existingSettings = await db
          .select()
          .from(userSettings)
          .where(eq(userSettings.userId, user.id))
          .limit(1);

        const settingsJson = JSON.stringify(input);

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

        return { success: true, settings: input };
      } catch (error) {
        if (error instanceof TRPCError) {
          throw error;
        }
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to update editor settings",
          cause: error instanceof Error ? error : new Error(String(error)),
        });
      }
    }),

  // Get AI status
  getAIStatus: protectedProcedure.query(async () => {
    try {
      // Get AI settings from the database
      const aiEnabledSetting = await storage.getSetting("aiEnabled");
      const isEnabled = aiEnabledSetting?.value === "true";

      return { enabled: isEnabled };
    } catch (error) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Failed to check AI status",
        cause: error instanceof Error ? error : new Error(String(error)),
      });
    }
  }),
});
