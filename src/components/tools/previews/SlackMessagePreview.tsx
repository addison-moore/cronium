"use client";

import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MessageSquare, Hash, AtSign } from "lucide-react";
import { format } from "date-fns";

interface SlackMessagePreviewProps {
  channel?: string;
  message?: string;
  username?: string;
  iconEmoji?: string;
  iconUrl?: string;
  blocks?: any[];
  attachments?: any[];
}

export function SlackMessagePreview({
  channel = "#general",
  message = "",
  username = "Cronium Bot",
  iconEmoji = ":robot_face:",
  iconUrl,
  blocks,
  attachments,
}: SlackMessagePreviewProps) {
  const renderIcon = () => {
    if (iconUrl) {
      return (
        <img src={iconUrl} alt={username} className="h-10 w-10 rounded-md" />
      );
    }

    if (iconEmoji === ":robot_face:") {
      return (
        <div className="flex h-10 w-10 items-center justify-center rounded-md bg-slate-600">
          <span className="text-xl">🤖</span>
        </div>
      );
    }

    return (
      <div className="flex h-10 w-10 items-center justify-center rounded-md bg-slate-600">
        <MessageSquare className="h-5 w-5 text-white" />
      </div>
    );
  };

  const formatMessage = (text: string) => {
    // Basic Slack markdown formatting
    return text
      .replace(/\*(.+?)\*/g, "<strong>$1</strong>") // Bold
      .replace(/_(.+?)_/g, "<em>$1</em>") // Italic
      .replace(/~(.+?)~/g, "<del>$1</del>") // Strikethrough
      .replace(/`(.+?)`/g, '<code class="bg-slate-700 px-1 rounded">$1</code>') // Code
      .replace(
        /^```([\s\S]+?)```$/gm,
        '<pre class="bg-slate-700 p-2 rounded mt-2">$1</pre>',
      ) // Code block
      .replace(/\n/g, "<br />"); // Line breaks
  };

  const renderChannel = () => {
    const isDirectMessage = channel.startsWith("@");
    const Icon = isDirectMessage ? AtSign : Hash;

    return (
      <div className="text-muted-foreground flex items-center gap-1 text-sm">
        <Icon className="h-3 w-3" />
        <span>{channel.replace(/^[@#]/, "")}</span>
      </div>
    );
  };

  return (
    <Card className="overflow-hidden">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Slack Message Preview</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="rounded-lg border bg-slate-900 p-4 text-slate-100">
          {/* Channel header */}
          <div className="mb-3 border-b border-slate-700 pb-3">
            {renderChannel()}
          </div>

          {/* Message */}
          <div className="flex gap-3">
            {renderIcon()}

            <div className="flex-1">
              <div className="flex items-baseline gap-2">
                <span className="font-semibold">{username}</span>
                <span className="text-xs text-slate-400">
                  {format(new Date(), "h:mm a")}
                </span>
              </div>

              <div
                className="mt-1 text-sm"
                dangerouslySetInnerHTML={{
                  __html: formatMessage(message),
                }}
              />

              {/* Blocks rendering (simplified) */}
              {blocks && blocks.length > 0 && (
                <div className="mt-3 space-y-2">
                  {blocks.map((block: any, index: number) => (
                    <div
                      key={index}
                      className="rounded border border-slate-700 bg-slate-800 p-2 text-sm"
                    >
                      {block.type === "section" && block.text?.text}
                      {block.type === "divider" && (
                        <hr className="border-slate-600" />
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Attachments (simplified) */}
              {attachments && attachments.length > 0 && (
                <div className="mt-3 space-y-2">
                  {attachments.map((attachment: any, index: number) => (
                    <div
                      key={index}
                      className="border-l-4 border-blue-500 bg-slate-800 p-3"
                    >
                      {attachment.title && (
                        <div className="font-semibold">{attachment.title}</div>
                      )}
                      {attachment.text && (
                        <div className="mt-1 text-sm">{attachment.text}</div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
