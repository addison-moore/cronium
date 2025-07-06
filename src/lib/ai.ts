import OpenAI from "openai";
import { storage } from "@/server/storage";
import { env } from "../env.mjs";

// Helper function to get OpenAI client with API key from settings
export async function getOpenAIClient() {
  // First check for the API key in environment variables
  const envApiKey = env.OPENAI_API_KEY;

  // Then check for the API key in database settings
  const apiKeySetting = await storage.getSetting("openaiApiKey");

  // Use environment variable first, then database setting
  const apiKey = envApiKey ?? apiKeySetting?.value;

  if (!apiKey) {
    throw new Error("OpenAI API key not configured");
  }

  return new OpenAI({
    apiKey: apiKey,
  });
}

// Function to generate code based on a prompt and script type
export async function generateScriptCode(
  prompt: string,
  scriptType: string,
  currentCode?: string,
) {
  const openai = await getOpenAIClient();

  // Get AI model from settings
  const modelSetting = await storage.getSetting("aiModel");
  const model = modelSetting?.value ?? "gpt-4o"; // default to gpt-4o if not set

  let systemPrompt = `You are an expert programmer that writes clean, efficient, and well-documented code. 
Generate code based on the user's request.`;

  // Add script type-specific instructions
  switch (scriptType) {
    case "NODEJS":
      systemPrompt += `\nWrite JavaScript code using Node.js. Include error handling.`;
      break;
    case "PYTHON":
      systemPrompt += `\nWrite Python code that follows PEP 8 guidelines. Include error handling.`;
      break;
    case "BASH":
      systemPrompt += `\nWrite Bash script with proper error handling. Add comments where appropriate.`;
      break;
    default:
      systemPrompt += `\nWrite code in the appropriate language for the task.`;
  }

  // Add modification instruction if existing code is provided
  const userPrompt = currentCode
    ? `${prompt}\n\nHere is my current code:\n\`\`\`\n${currentCode}\n\`\`\``
    : prompt;

  try {
    // the newest OpenAI model is "gpt-4o" which was released May 13, 2024. do not change this unless explicitly requested by the user
    const response = await openai.chat.completions.create({
      model: model, // Use the model from settings
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.7,
      max_tokens: 2000,
    });

    const content = response.choices[0]?.message.content ?? "";

    // Extract code from response if it's wrapped in markdown code blocks
    const codeBlockRegex = /```(?:\w+)?\s*\n([\s\S]+?)\n```/;
    const match = codeBlockRegex.exec(content);

    // If code block is found, return just the code inside it
    if (match?.[1]) {
      return match[1].trim();
    }

    // Otherwise return the whole content (it might be code without markdown formatting)
    return content.trim();
  } catch (error: unknown) {
    console.error("Error generating code with OpenAI:", error);
    throw new Error(`Failed to generate code: ${String(error)}`);
  }
}
