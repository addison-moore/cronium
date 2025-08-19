import { z } from "zod";

// Authentication type enum
export enum AuthType {
  SSH_KEY = "SSH_KEY",
  PASSWORD = "PASSWORD",
}

// Unified server schema that handles both create and update scenarios
export const serverFormSchema = z
  .object({
    name: z.string().min(1, "Server name is required"),
    address: z.string().min(1, "Server address is required"),
    authType: z.nativeEnum(AuthType).default(AuthType.SSH_KEY),
    sshKey: z.string().optional(),
    password: z.string().optional(),
    username: z.string().min(1),
    port: z.coerce.number().int().min(1).max(65535),
    shared: z.boolean(),
  })
  .refine(
    (data) => {
      // Ensure appropriate auth field is provided based on authType
      if (data.authType === AuthType.SSH_KEY) {
        return data.sshKey && data.sshKey.length > 0;
      } else if (data.authType === AuthType.PASSWORD) {
        return data.password && data.password.length > 0;
      }
      return false;
    },
    {
      message: "Authentication credentials are required",
      path: ["authType"],
    },
  );

// Legacy exports for backwards compatibility
export const serverSchema = serverFormSchema;

export const updateServerFormSchema = serverFormSchema;

export type ServerFormValues = z.infer<typeof serverSchema>;
export type UpdateServerFormValues = z.infer<typeof serverFormSchema>;
