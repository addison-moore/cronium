import { z } from "zod";
import type {
  ToolAction,
  ToolActionContext,
} from "@/components/tools/types/tool-plugin";

// Schema for upload-file action parameters
export const uploadFileSchema = z.object({
  channels: z
    .string()
    .describe(
      "Comma-separated list of channel IDs or names where the file will be shared",
    ),
  content: z
    .string()
    .optional()
    .describe("File content as text (for text-based files)"),
  file_url: z
    .string()
    .url()
    .optional()
    .describe("URL of a file to upload (alternative to content)"),
  filename: z.string().optional().describe("Filename for the upload"),
  filetype: z
    .string()
    .optional()
    .describe("File type (e.g., 'text', 'pdf', 'png', 'json')"),
  initial_comment: z
    .string()
    .optional()
    .describe("Initial comment to add to the file"),
  title: z.string().optional().describe("Title of the file"),
  thread_ts: z
    .string()
    .optional()
    .describe("Thread timestamp to upload file to a specific thread"),
});

export type UploadFileParams = z.infer<typeof uploadFileSchema>;

// Note: This action requires Slack Web API access, not just webhooks
export const uploadFileAction: ToolAction<UploadFileParams> = {
  id: "upload-file",
  name: "Upload File",
  description: "Upload a file to Slack channels (requires OAuth token)",
  category: "create",
  inputSchema: uploadFileSchema,
  outputSchema: z.object({
    ok: z.boolean(),
    file: z
      .object({
        id: z.string(),
        name: z.string(),
        title: z.string().optional(),
        mimetype: z.string(),
        filetype: z.string(),
        size: z.number(),
        url_private: z.string(),
        url_private_download: z.string(),
        permalink: z.string(),
        permalink_public: z.string().optional(),
        channels: z.array(z.string()),
        groups: z.array(z.string()),
        ims: z.array(z.string()),
        comments_count: z.number(),
      })
      .optional(),
    error: z.string().optional(),
  }),
  examples: [
    {
      name: "Upload Text Report",
      input: {
        channels: "#reports,#analytics",
        content:
          "Monthly Sales Report\n\nTotal Revenue: $125,000\nNew Customers: 45\nChurn Rate: 2.3%",
        filename: "sales-report-2024-01.txt",
        filetype: "text",
        title: "January 2024 Sales Report",
        initial_comment:
          "Here's the monthly sales report as requested. Key highlights: revenue up 15% YoY.",
      },
      output: {
        ok: true,
        file: {
          id: "F1234567890",
          name: "sales-report-2024-01.txt",
          title: "January 2024 Sales Report",
          mimetype: "text/plain",
          filetype: "text",
          size: 1234,
          url_private: "https://files.slack.com/...",
          url_private_download: "https://files.slack.com/.../download",
          permalink: "https://workspace.slack.com/files/...",
          channels: ["C1234567890", "C0987654321"],
          groups: [],
          ims: [],
          comments_count: 0,
        },
      },
    },
    {
      name: "Upload CSV Data",
      input: {
        channels: "#data-team",
        content:
          "name,email,signup_date\nJohn Doe,john@example.com,2024-01-15\nJane Smith,jane@example.com,2024-01-16",
        filename: "new-signups.csv",
        filetype: "csv",
        title: "New User Signups",
      },
      output: {
        ok: true,
        file: {
          id: "F0987654321",
          name: "new-signups.csv",
          title: "New User Signups",
          mimetype: "text/csv",
          filetype: "csv",
          size: 98,
          url_private: "https://files.slack.com/...",
          url_private_download: "https://files.slack.com/.../download",
          permalink: "https://workspace.slack.com/files/...",
          channels: ["C1111111111"],
          groups: [],
          ims: [],
          comments_count: 0,
        },
      },
    },
  ],
  async execute(params: UploadFileParams, context: ToolActionContext) {
    const { updateProgress, getVariable, credentials } = context as {
      updateProgress: (progress: number, message: string) => Promise<void>;
      getVariable: (key: string) => string | undefined;
      credentials: Record<string, unknown>;
    };

    try {
      await updateProgress(10, "Preparing file upload...");

      // Check if we have an OAuth token (Phase 2 feature)
      const accessToken = credentials.accessToken as string | undefined;
      if (!accessToken) {
        throw new Error(
          "This action requires Slack OAuth authentication. Currently only webhook-based actions are supported.",
        );
      }

      // Validate input - need either content or file_url
      if (!params.content && !params.file_url) {
        throw new Error("Either content or file_url must be provided");
      }

      await updateProgress(30, "Processing file content...");

      // Replace variables in content if provided
      let processedContent = params.content;
      if (processedContent) {
        processedContent = processedContent.replace(
          /\{\{(\w+)\}\}/g,
          (match, key: string) => {
            const value = getVariable(key);
            return value !== undefined ? String(value) : match;
          },
        );
      }

      await updateProgress(50, "Uploading file to Slack...");

      // Build form data for file upload
      const formData = new FormData();
      formData.append("channels", params.channels);

      if (processedContent) {
        formData.append("content", processedContent);
      }
      if (params.file_url) {
        formData.append("file", params.file_url);
      }
      if (params.filename) {
        formData.append("filename", params.filename);
      }
      if (params.filetype) {
        formData.append("filetype", params.filetype);
      }
      if (params.initial_comment) {
        formData.append("initial_comment", params.initial_comment);
      }
      if (params.title) {
        formData.append("title", params.title);
      }
      if (params.thread_ts) {
        formData.append("thread_ts", params.thread_ts);
      }

      // Make API request to upload file
      const response = await fetch("https://slack.com/api/files.upload", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
        body: formData,
      });

      const data = (await response.json()) as {
        ok: boolean;
        file?: {
          id: string;
          name: string;
          title?: string;
          mimetype: string;
          filetype: string;
          size: number;
          url_private: string;
          url_private_download: string;
          permalink: string;
          permalink_public?: string;
          channels: string[];
          groups: string[];
          ims: string[];
          comments_count: number;
        };
        error?: string;
      };

      await updateProgress(90, "Processing response...");

      if (!data.ok) {
        throw new Error(data.error ?? "Failed to upload file");
      }

      await updateProgress(100, "File uploaded successfully!");

      return {
        ok: true,
        file: data.file,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error occurred";
      await updateProgress(100, `Failed: ${errorMessage}`);
      return {
        ok: false,
        error: errorMessage,
      };
    }
  },
  // Mark as requiring OAuth
  requiresOAuth: true,
};
