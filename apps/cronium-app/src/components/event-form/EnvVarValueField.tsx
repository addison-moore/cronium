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

// One line copied from a terminal usually ends in a line break, which would break
// `Authorization: Bearer $TOKEN`. A multi-line value keeps its last one, because
// OpenSSH won't load a key file without it.
function tidyPastedValue(value: string): string {
  return value.replace(/^([^\n]*)\n+$/, "$1");
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

  const insertWithLineBreaks = (
    event: SyntheticEvent<HTMLInputElement>,
    text: string,
  ) => {
    if (countLineBreaks(text) === 0) return;
    event.preventDefault();
    const start = event.currentTarget.selectionStart ?? value.length;
    const end = event.currentTarget.selectionEnd ?? value.length;
    // The same line endings a textarea would give a paste.
    const inserted = text.replace(/\r\n?/g, "\n");
    onChange(
      tidyPastedValue(value.slice(0, start) + inserted + value.slice(end)),
    );
  };

  return (
    <>
      <div className="flex items-start gap-2">
        {shown ? (
          <Textarea
            id={id}
            value={value}
            onChange={(event) => {
              const { inputType } = event.nativeEvent as InputEvent;
              onChange(
                inputType === "insertFromPaste"
                  ? tidyPastedValue(event.target.value)
                  : event.target.value,
              );
            }}
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
            onChange={(event) => onChange(event.target.value)}
            onPaste={
              lineBreaks > 0
                ? undefined
                : (event) =>
                    insertWithLineBreaks(
                      event,
                      event.clipboardData.getData("text"),
                    )
            }
            onDrop={
              lineBreaks > 0
                ? undefined
                : (event) =>
                    insertWithLineBreaks(
                      event,
                      event.dataTransfer.getData("text"),
                    )
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
