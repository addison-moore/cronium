"use client";

import React from "react";
import Image from "next/image";
import { Card, CardContent, CardHeader, CardTitle } from "@cronium/ui";
import { MessageSquare, Hash, AtSign } from "lucide-react";
import { format } from "date-fns";
import { formatSlackMessage } from "./format-slack-message";

// Only whole https addresses. The page's CSP blocks an image over http, half-typed ones
// would be requests to this site, and outside production `next/image` throws on `https://`
// while rendering, which takes the whole page down.
const isHttpsUrl = (address: string): boolean => {
  try {
    return new URL(address).protocol === "https:";
  } catch {
    return false;
  }
};

interface SlackMessagePreviewProps {
  title?: string;
  channel?: string;
  message?: string;
  username?: string;
  iconEmoji?: string;
  iconUrl?: string;
  blocks?: Array<{ type?: string; text?: { text?: string } }>;
  attachments?: Array<{ title?: string; text?: string }>;
}

export function SlackMessagePreview({
  title = "Slack Message Preview",
  channel,
  message = "",
  username = "Cronium Bot",
  iconEmoji = ":robot_face:",
  iconUrl,
  blocks,
  attachments,
}: SlackMessagePreviewProps) {
  const renderIcon = () => {
    // An address someone typed, so not one for Next's optimizer: it only takes the hosts
    // in next.config.mjs, answers 400 for the rest, and `next dev` throws while rendering.
    if (iconUrl && isHttpsUrl(iconUrl)) {
      return (
        <Image
          src={iconUrl}
          alt={username ?? "User avatar"}
          width={40}
          height={40}
          unoptimized
          className="h-10 w-10 rounded-md object-cover"
        />
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

  const renderChannel = () => {
    // A webhook posts to its own channel unless the message names another.
    if (!channel) {
      return (
        <div className="text-muted-foreground text-sm">
          The webhook&apos;s channel
        </div>
      );
    }

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
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="border-border rounded-lg border bg-slate-900 p-4 text-slate-100">
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

              <div className="mt-1 text-sm">{formatSlackMessage(message)}</div>

              {/* Blocks rendering (simplified) */}
              {blocks && blocks.length > 0 && (
                <div className="mt-3 space-y-2">
                  {blocks.map(
                    (
                      block: { type?: string; text?: { text?: string } },
                      index: number,
                    ) => (
                      <div
                        key={index}
                        className="rounded-md border border-slate-700 bg-slate-800 p-2 text-sm"
                      >
                        {block.type === "section" && block.text?.text}
                        {block.type === "divider" && (
                          <hr className="border border-slate-600" />
                        )}
                      </div>
                    ),
                  )}
                </div>
              )}

              {/* Attachments (simplified) */}
              {attachments && attachments.length > 0 && (
                <div className="mt-3 space-y-2">
                  {attachments.map(
                    (
                      attachment: { title?: string; text?: string },
                      index: number,
                    ) => (
                      <div
                        key={index}
                        className="border-l-4 border-blue-500 bg-slate-800 p-3"
                      >
                        {attachment.title && (
                          <div className="font-semibold">
                            {attachment.title}
                          </div>
                        )}
                        {attachment.text && (
                          <div className="mt-1 text-sm">{attachment.text}</div>
                        )}
                      </div>
                    ),
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
