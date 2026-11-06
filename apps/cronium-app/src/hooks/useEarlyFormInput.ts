"use client";

import { useCallback, useLayoutEffect, useRef } from "react";
import type {
  FieldValues,
  Path,
  PathValue,
  UseFormReturn,
} from "react-hook-form";

/*
 * A server-rendered form can be used before React has hydrated it, which on a slow connection
 * can take many seconds. Pressing a form with no `action` then is the browser's own GET, with
 * every field in the URL, so a password lands in the browser's history, in the `Referer` of
 * whatever the page loads next, and in a reverse proxy's access log.
 *
 * A function as the form's `action` stops that. React serves the form with a placeholder
 * `action` that can't leave the page, plus an inline script that holds a press until hydration
 * and then calls the function. Every later press still goes to `onSubmit`: handleSubmit calls
 * preventDefault, and React then leaves the `action` alone.
 *
 * `method="post"` isn't an alternative here. It keeps the fields out of the URL, but the page
 * reloads and the person loses what they typed, with nothing to say why.
 */

/**
 * Spread the result on a server-rendered react-hook-form form, next to its `onSubmit`, so input
 * made before hydration counts:
 *
 * - A press is honored once React arrives, as if it had happened then.
 * - What was typed or filled in stays. React doesn't read an input's value when it hydrates it,
 *   so the form's state still has the default, and the next render writes that over the input.
 *
 * Only for a form whose fields are all strings and whose defaults aren't loaded after hydration.
 * Otherwise use {@link ignoreEarlyPress}.
 */
export function useEarlyFormInput<T extends FieldValues>(
  form: UseFormReturn<T>,
) {
  const ref = useRef<HTMLFormElement>(null);
  const pressReplayed = useRef(false);

  // A layout effect, because it runs at sync priority. Passive effects in a hydrating Suspense
  // boundary, which every page here is, run at idle priority, so their updates can wait behind
  // any other work, and each render in the meantime writes the old value over the input.
  useLayoutEffect(() => {
    if (!ref.current) return;
    for (const [name, value] of new FormData(ref.current)) {
      form.setValue(name as Path<T>, value as PathValue<T, Path<T>>);
    }
  }, [form]);

  const action = useCallback(() => {
    // React replays every early press, one after the other. They all meant the same thing.
    if (pressReplayed.current) return;
    pressReplayed.current = true;
    ref.current?.requestSubmit();
  }, []);

  return { ref, action };
}

/**
 * The `action` for a server-rendered form that holds a secret and can't act on a press made
 * before hydration, such as one whose stored values load after it, where acting on the press
 * would save blanks over them. The press does nothing and no secret reaches a URL, though what
 * was typed is still lost at hydration. See the comment at the top of this file.
 */
export function ignoreEarlyPress() {
  // Being a function is the point.
}
