import { z } from "zod";
import { createTRPCRouter, protectedProcedure, withTiming } from "../trpc";
import { withErrorHandling } from "@/server/utils/error-utils";
import {
  resourceResponse,
  mutationResponse,
} from "@/server/utils/api-patterns";
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
  getEditorSettings: protectedProcedure
    .use(withTiming)
    .query(async ({ ctx }) => {
      return withErrorHandling(
        async () => {
          // Get user settings
          const settings = await db
            .select()
            .from(userSettings)
            .where(eq(userSettings.userId, ctx.session.user.id))
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

          return resourceResponse(editorSettings);
        },
        {
          component: "settingsRouter",
          operationName: "getEditorSettings",
          userId: ctx.session.user.id,
        },
      );
    }),

  // Update user editor settings
  updateEditorSettings: protectedProcedure
    .use(withTiming)
    .input(editorSettingsSchema)
    .mutation(async ({ ctx, input }) => {
      return withErrorHandling(
        async () => {
          // Check if user settings exist
          const existingSettings = await db
            .select()
            .from(userSettings)
            .where(eq(userSettings.userId, ctx.session.user.id))
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
              .where(eq(userSettings.userId, ctx.session.user.id));
          } else {
            // Create new settings
            await db.insert(userSettings).values({
              userId: ctx.session.user.id,
              editorSettings: settingsJson,
              createdAt: new Date(),
              updatedAt: new Date(),
            });
          }

          return mutationResponse(
            { settings: input },
            "Editor settings updated successfully",
          );
        },
        {
          component: "settingsRouter",
          operationName: "updateEditorSettings",
          userId: ctx.session.user.id,
        },
      );
    }),

  // Get AI status
  getAIStatus: protectedProcedure.use(withTiming).query(async ({ ctx }) => {
    return withErrorHandling(
      async () => {
        // Get AI settings from the database
        const aiEnabledSetting = await storage.getSetting("aiEnabled");
        const isEnabled = aiEnabledSetting?.value === "true";

        return resourceResponse({ enabled: isEnabled });
      },
      {
        component: "settingsRouter",
        operationName: "getAIStatus",
        userId: ctx.session.user.id,
      },
    );
  }),
});
