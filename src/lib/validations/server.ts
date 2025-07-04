import { z } from "zod";

// Unified server schema that handles both create and update scenarios
export const serverFormSchema = z.object({
  name: z.string().min(1, "Server name is required"),
  address: z.string().min(1, "Server address is required"),
  sshKey: z.string().optional(), // Optional for updates, required validation handled in component
  username: z.string().min(1),
  port: z.coerce.number().int().min(1).max(65535),
  shared: z.boolean(),
});

// Legacy exports for backwards compatibility
export const serverSchema = serverFormSchema.extend({
  sshKey: z.string().min(1, "SSH key is required"),
});

export const updateServerFormSchema = serverFormSchema;

export type ServerFormValues = z.infer<typeof serverSchema>;
export type UpdateServerFormValues = z.infer<typeof serverFormSchema>;
