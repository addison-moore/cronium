"use client";

import React, { useId, useMemo } from "react";
import { Button } from "@cronium/ui";
import { X } from "lucide-react";
import type { ShownResult } from "@/tools/types/tool-plugin";
import { cn } from "@/lib/utils";
import { fitResult, type FittedResult } from "./run-result";

interface RunResultProps {
  /** The action that ran, and the credential it ran on. */
  actionName: string;
  credentialName: string;
  /** What the toast said about the run. */
  summary: string;
  shown: ShownResult;
  /** Whether the parameters have changed since it ran. */
  stale: boolean;
  onDismiss: () => void;
}

// A page of rows, then it scrolls, so the parameters below stay close.
const SCROLLS = "border-border max-h-80 overflow-auto rounded-md border";

function Drawn({ fitted }: { fitted: FittedResult }) {
  switch (fitted.type) {
    case "rows":
      if (fitted.columns.length === 0) return null;
      return (
        <div className={SCROLLS}>
          {/* As wide as its columns, each up to 20rem, so a narrow screen scrolls the
              table rather than squeezing a column to a word a line. A cell's own
              max-width does nothing in a table, so the cap is on a div inside it. */}
          <table className="w-max min-w-full text-left text-xs">
            <thead>
              <tr>
                {fitted.columns.map((column, index) => (
                  <th
                    key={index}
                    scope="col"
                    className="bg-muted sticky top-0 px-2 py-1.5 font-medium whitespace-nowrap"
                  >
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {fitted.rows.map((cells, row) => (
                <tr key={row} className="border-border border-t">
                  {cells.map((cell, column) => (
                    <td
                      key={column}
                      className="px-2 py-1.5 align-top font-mono"
                    >
                      <div className="max-w-xs break-words whitespace-pre-wrap">
                        {cell ?? (
                          <span className="text-muted-foreground italic">
                            NULL
                          </span>
                        )}
                      </div>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "documents":
      if (fitted.documents.length === 0) return null;
      return (
        <div className={cn(SCROLLS, "divide-border divide-y")}>
          {fitted.documents.map((document, index) => (
            <pre
              key={index}
              className="px-3 py-2 font-mono text-xs break-words whitespace-pre-wrap"
            >
              {document}
            </pre>
          ))}
        </div>
      );
    case "text":
      return (
        <div className="space-y-1">
          {fitted.text ? (
            <div
              className={cn(
                SCROLLS,
                "px-3 py-2 break-words whitespace-pre-wrap",
                fitted.format === "json" ? "font-mono text-xs" : "text-sm",
              )}
            >
              {fitted.text}
            </div>
          ) : (
            <p className="text-muted-foreground text-sm italic">
              The answer was empty.
            </p>
          )}
          {fitted.about && (
            <p className="text-muted-foreground text-xs">{fitted.about}</p>
          )}
          {fitted.warning && (
            <p className="text-warning-text text-sm">{fitted.warning}</p>
          )}
        </div>
      );
  }
}

/**
 * What a run from the event form returned, under its button. The section only shows one
 * about the credential and action on screen, and says when the parameters have changed.
 */
export default function RunResult({
  actionName,
  credentialName,
  summary,
  shown,
  stale,
  onDismiss,
}: RunResultProps) {
  const headingId = useId();
  const { fitted, cuts } = useMemo(() => fitResult(shown), [shown]);

  return (
    <section
      aria-labelledby={headingId}
      className="border-border min-w-0 space-y-3 rounded-lg border p-4"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 space-y-1">
          <h4 id={headingId} className="text-sm font-medium break-words">
            Result of {actionName} on {credentialName}
          </h4>
          <p className="text-muted-foreground text-sm">{summary}</p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onDismiss}
          aria-label="Dismiss the result"
          className="h-8 w-8 shrink-0 p-0"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
      {stale && (
        <p className="text-warning-text text-sm">
          The parameters have changed since this ran.
        </p>
      )}
      <Drawn fitted={fitted} />
      {cuts.length > 0 && (
        <div className="text-muted-foreground space-y-1 text-xs">
          {cuts.map((words) => (
            <p key={words}>{words}</p>
          ))}
        </div>
      )}
    </section>
  );
}
