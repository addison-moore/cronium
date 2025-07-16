"use client";

import { useState } from "react";
import { Sparkles, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { toast } from "@/components/ui/use-toast";
import { EventType } from "@/shared/schema";
import { trpc } from "@/lib/trpc";
import { MonacoEditor } from "@/components/ui/monaco-editor-lazy";
import { QUERY_OPTIONS } from "@/trpc/shared";

interface AIScriptAssistantProps {
  onApplyCode: (code: string) => void;
  scriptType: EventType;
  currentCode?: string;
}

export default function AIScriptAssistant({
  onApplyCode,
  scriptType,
  currentCode = "",
}: AIScriptAssistantProps) {
  const [prompt, setPrompt] = useState("");
  const [generatedCode, setGeneratedCode] = useState("");

  // tRPC queries and mutations
  const { data: aiStatus, isLoading: checkingStatus } =
    trpc.settings.getAIStatus.useQuery(undefined, QUERY_OPTIONS.static);

  const generateCodeMutation = trpc.ai.generateScript.useMutation({
    onSuccess: (data) => {
      setGeneratedCode(data.code);
      toast({
        title: "Code Generated",
        description: "AI has generated code based on your prompt",
      });
    },
    onError: (error) => {
      console.error("Error generating code:", error);

      // Handle specific error codes with better messages
      let errorMessage =
        error.message || "Failed to generate code. Please try again.";

      if (error.data?.code === "UNAUTHORIZED") {
        errorMessage = "You need to be logged in to use the AI assistant";
      } else if (error.data?.code === "FORBIDDEN") {
        errorMessage =
          "AI script assistant is not enabled by the administrator";
      } else if (error.data?.code === "SERVICE_UNAVAILABLE") {
        errorMessage =
          "OpenAI API key is not configured. Please contact your administrator";
      }

      toast({
        title: "Error",
        description: errorMessage,
        variant: "destructive",
      });
    },
  });

  const isEnabled = aiStatus?.enabled ?? false;

  const generateCode = async () => {
    if (!prompt.trim()) {
      toast({
        title: "Error",
        description: "Please enter a prompt describing what you want to create",
        variant: "destructive",
      });
      return;
    }

    setGeneratedCode("");

    try {
      await generateCodeMutation.mutateAsync({
        prompt,
        scriptType,
        currentCode: currentCode || "",
      });
    } catch (error) {
      console.error("Error in generateCode function:", error);

      // Display a user-friendly error message
      toast({
        title: "Error Generating Code",
        description:
          typeof error === "object" && error !== null && "message" in error
            ? String(error.message)
            : "An unexpected error occurred. Please try again later.",
        variant: "destructive",
      });
    }
  };

  const handleApply = () => {
    onApplyCode(generatedCode);
    toast({
      title: "Code Applied",
      description: "The generated code has been applied to your script",
    });
    setGeneratedCode(""); // Clear after applying
    setPrompt(""); // Clear prompt as well
  };

  const getLanguageForEditor = () => {
    switch (scriptType) {
      case EventType.BASH:
        return "bash";
      case EventType.NODEJS:
        return "javascript";
      case EventType.PYTHON:
        return "python";
      default:
        return "bash";
    }
  };

  // Don't render anything if AI is not enabled or still checking
  if (checkingStatus || !isEnabled) {
    return null;
  }

  return (
    <Card className="mb-4 border border-blue-200 bg-blue-50/50 dark:border-blue-900 dark:bg-blue-950/20">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center justify-between text-lg">
          <div className="flex items-center">
            <Sparkles className="mr-2 h-4 w-4 text-blue-500" />
            AI Script Assistant
          </div>
          <Button
            type="button"
            onClick={generateCode}
            className="flex items-center gap-2"
            disabled={generateCodeMutation.isPending || !prompt.trim()}
            size="sm"
          >
            {generateCodeMutation.isPending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Generating...
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4" />
                Generate Code
              </>
            )}
          </Button>
        </CardTitle>
      </CardHeader>

      <CardContent>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="ai-prompt">Describe what you want to create</Label>
            <Textarea
              id="ai-prompt"
              placeholder={`Example: "Create a ${scriptType.toLowerCase().replace("_", " ")} that monitors disk usage and sends an alert if it exceeds 80%"`}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={3}
              className="resize-none"
            />
          </div>

          {generatedCode && (
            <div className="space-y-2">
              <Label>Generated Code</Label>
              <div className="overflow-hidden rounded-lg border">
                <MonacoEditor
                  height="300px"
                  language={getLanguageForEditor()}
                  value={generatedCode}
                  onChange={(value) => setGeneratedCode(value || "")}
                  editorSettings={{
                    fontSize: 14,
                    theme: "vs-dark",
                    minimap: false,
                    lineNumbers: true,
                    wordWrap: true,
                  }}
                />
              </div>
            </div>
          )}
        </div>
      </CardContent>

      {generatedCode && (
        <CardFooter className="flex justify-between">
          <Button
            variant="outline"
            onClick={() => {
              setGeneratedCode("");
              setPrompt("");
            }}
          >
            Clear
          </Button>
          <Button onClick={handleApply} className="flex items-center gap-2">
            <Sparkles className="h-4 w-4" />
            Apply to Script
          </Button>
        </CardFooter>
      )}
    </Card>
  );
}
