"use client";

import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@cronium/ui";
import { Mail, Paperclip, User } from "lucide-react";
import { Badge } from "@cronium/ui";

interface EmailPreviewProps {
  to: string | string[];
  cc?: string | string[];
  bcc?: string | string[];
  subject: string;
  body: string;
  fromEmail?: string;
  fromName?: string;
  attachments?: string[];
  priority?: "low" | "normal" | "high";
  isHtml?: boolean;
}

export function EmailPreview({
  to,
  cc,
  bcc,
  subject,
  body,
  fromEmail = "noreply@cronium.app",
  fromName = "Cronium",
  attachments = [],
  priority = "normal",
  isHtml = false,
}: EmailPreviewProps) {
  const formatEmails = (emails: string | string[]) => {
    return Array.isArray(emails) ? emails.join(", ") : emails;
  };

  const renderBody = () => {
    if (isHtml) {
      // For HTML emails, render in an iframe for safety
      return (
        <div className="border-border relative h-64 w-full overflow-hidden rounded border">
          <iframe
            srcDoc={body}
            className="h-full w-full"
            sandbox="allow-same-origin"
            title="Email preview"
          />
        </div>
      );
    }

    // For plain text, convert line breaks and preserve formatting
    return (
      <div className="border-border rounded border bg-gray-50 p-4 font-mono text-sm whitespace-pre-wrap dark:bg-gray-900">
        {body}
      </div>
    );
  };

  const getPriorityColor = () => {
    switch (priority) {
      case "high":
        return "destructive";
      case "low":
        return "secondary";
      default:
        return "default";
    }
  };

  return (
    <Card className="overflow-hidden">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <Mail className="h-4 w-4" />
            Email Preview
          </CardTitle>
          {priority !== "normal" && (
            <Badge variant={getPriorityColor()}>{priority} priority</Badge>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {/* From */}
          <div className="flex items-start gap-2">
            <span className="text-muted-foreground min-w-16 text-sm font-medium">
              From:
            </span>
            <div className="flex items-center gap-2">
              <User className="h-4 w-4" />
              <span className="text-sm">
                {fromName} &lt;{fromEmail}&gt;
              </span>
            </div>
          </div>

          {/* To */}
          <div className="flex items-start gap-2">
            <span className="text-muted-foreground min-w-16 text-sm font-medium">
              To:
            </span>
            <span className="text-sm">{formatEmails(to)}</span>
          </div>

          {/* CC */}
          {cc && cc.length > 0 && (
            <div className="flex items-start gap-2">
              <span className="text-muted-foreground min-w-16 text-sm font-medium">
                Cc:
              </span>
              <span className="text-sm">{formatEmails(cc)}</span>
            </div>
          )}

          {/* BCC */}
          {bcc && bcc.length > 0 && (
            <div className="flex items-start gap-2">
              <span className="text-muted-foreground min-w-16 text-sm font-medium">
                Bcc:
              </span>
              <span className="text-sm">{formatEmails(bcc)}</span>
            </div>
          )}

          {/* Subject */}
          <div className="flex items-start gap-2">
            <span className="text-muted-foreground min-w-16 text-sm font-medium">
              Subject:
            </span>
            <span className="font-semibold">{subject}</span>
          </div>

          {/* Attachments */}
          {attachments.length > 0 && (
            <div className="flex items-start gap-2">
              <span className="text-muted-foreground min-w-16 text-sm font-medium">
                Files:
              </span>
              <div className="flex flex-wrap gap-2">
                {attachments.map((file, index) => (
                  <Badge key={index} variant="outline" className="gap-1">
                    <Paperclip className="h-3 w-3" />
                    {file.split("/").pop()}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {/* Separator */}
          <hr className="my-4" />

          {/* Body */}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-muted-foreground text-sm font-medium">
                Message:
              </span>
              {isHtml && (
                <Badge variant="outline" className="text-xs">
                  HTML
                </Badge>
              )}
            </div>
            {renderBody()}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
