"use client";

import { useId, type SyntheticEvent } from "react";
import { Eye, EyeOff } from "lucide-react";
import { Button } from "@cronium/ui";
import { Input } from "@cronium/ui";
import { Textarea } from "@cronium/ui";

const copy = {
  ShowValue: "Show value",
  HideValue: "Hide value",
  lineBreaksNote: (count: number) =>
    `This value has ${count} line ${count === 1 ? "break" : "breaks"}. Show it to edit.`,
} as const;

// A shown value grows with its lines up to here, then scrolls, so a long one can't
// push the rest of the form away. Lines don't wrap, so the height is exact.
const MAX_ROWS = 8;

// Keeps the browser and writing extensions out of a shown value. A password input
// gets all of this without asking.
const SECRET_FIELD_PROPS = {
  autoComplete: "off",
  autoCapitalize: "off",
  autoCorrect: "off",
  spellCheck: false,
  "data-gramm": "false",
  "data-gramm_editor": "false",
  "data-enable-grammarly": "false",
} as const;

function countLineBreaks(value: string): number {
  return value.match(/\r\n|\r|\n/g)?.length ?? 0;
}

// Gives pasted text the line endings a textarea would. One line copied from a terminal
// usually ends in a line break, which would break `Authorization: Bearer $TOKEN`, so
// that goes. Multi-line text keeps its last one, because OpenSSH won't load a key file
// without it.
function tidyPastedText(text: string): string {
  return text.replace(/\r\n?/g, "\n").replace(/^([^\n]*)\n+$/, "$1");
}

interface EnvVarValueFieldProps {
  id: string;
  value: string;
  onChange: (value: string) => void;
  shown: boolean;
  onToggleShown: () => void;
  placeholder: string;
  invalid: boolean;
}

/**
 * A value can hold line breaks, like a PEM key's. A <textarea> keeps them but has no
 * password type, and its stand-in, -webkit-text-security, only paints dots: a screen
 * reader still gets the real text, Firefox still copies it, and a browser without the
 * property shows it. So a hidden value is never in a textarea. It's in a password
 * input, and only a shown one is in a textarea.
 *
 * A password input can't hold a line break, so a hidden value's stay in the form's
 * state: pastes and drops that have them go straight there, and a hidden value that
 * has them can't be edited until it's shown.
 */
export default function EnvVarValueField({
  id,
  value,
  onChange,
  shown,
  onToggleShown,
  placeholder,
  invalid,
}: EnvVarValueFieldProps) {
  const noteId = useId();
  const lineBreaks = countLineBreaks(value);
  const showNote = !shown && lineBreaks > 0;

  const insertPasted = (
    event: SyntheticEvent<HTMLInputElement | HTMLTextAreaElement>,
    text: string,
  ) => {
    if (countLineBreaks(text) === 0) return;
    const inserted = tidyPastedText(text);
    const multiLine = countLineBreaks(inserted) > 0;
    // A textarea takes line breaks itself, and keeps the caret and undo.
    if (shown && multiLine) return;

    event.preventDefault();
    const field = event.currentTarget;
    const start = field.selectionStart ?? field.value.length;
    const end = field.selectionEnd ?? field.value.length;
    if (multiLine) {
      // A password input would turn them into spaces.
      onChange(value.slice(0, start) + inserted + value.slice(end));
    } else {
      // Inserted as typing would be, so the caret stays after it and React sees it.
      field.setRangeText(inserted, start, end, "end");
      field.dispatchEvent(new Event("input", { bubbles: true }));
    }
  };

  return (
    <>
      <div className="flex items-start gap-2">
        {shown ? (
          <Textarea
            id={id}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            onPaste={(event) =>
              insertPasted(event, event.clipboardData.getData("text"))
            }
            placeholder={placeholder}
            rows={Math.min(lineBreaks + 1, MAX_ROWS)}
            wrap="off"
            className="border-border bg-input text-foreground placeholder:text-muted-foreground dark:bg-input dark:text-foreground dark:placeholder:text-muted-foreground min-h-10 min-w-0 resize-y font-mono placeholder:font-sans"
            aria-invalid={invalid}
            {...SECRET_FIELD_PROPS}
          />
        ) : (
          <Input
            id={id}
            type="password"
            value={value}
            readOnly={lineBreaks > 0}
            // Its own value is a flattened copy of one with line breaks, and a browser
            // still fires `change` when the field loses focus after an earlier edit.
            onChange={
              lineBreaks > 0
                ? undefined
                : (event) => onChange(event.target.value)
            }
            onPaste={
              lineBreaks > 0
                ? undefined
                : (event) =>
                    insertPasted(event, event.clipboardData.getData("text"))
            }
            onDrop={
              lineBreaks > 0
                ? undefined
                : (event) =>
                    insertPasted(event, event.dataTransfer.getData("text"))
            }
            placeholder={placeholder}
            className="min-w-0"
            aria-invalid={invalid}
            aria-describedby={showNote ? noteId : undefined}
          />
        )}
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="shrink-0"
          aria-label={shown ? copy.HideValue : copy.ShowValue}
          onClick={onToggleShown}
        >
          {shown ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </Button>
      </div>
      {showNote && (
        <p id={noteId} className="text-muted-foreground mt-1 text-sm">
          {copy.lineBreaksNote(lineBreaks)}
        </p>
      )}
    </>
  );
}
