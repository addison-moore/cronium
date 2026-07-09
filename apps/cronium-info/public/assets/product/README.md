# Product screenshots

Drop real captures of the Cronium UI here.

## Swapping in the workflow canvas screenshot

`src/components/landing/features/WorkflowCanvasPreview.tsx` currently renders a
hand-drawn SVG diagram of an example workflow. To replace it with a real
screenshot or GIF of the workflow canvas:

1. Capture the canvas at a 16:10 aspect ratio (e.g. 1600×1000). Anything else
   gets cropped by `object-cover`.
2. Save it here as `workflow-canvas.png` (a `.gif` or `.webp` works too — update
   `CANVAS_SRC` if you change the extension).
3. In `WorkflowCanvasPreview.tsx`, change:

   ```ts
   const CANVAS_MODE: "svg" | "image" = "svg";
   //                                    ^^^^^  ->  "image"
   ```

4. Update `CANVAS_ALT` in that file so the alt text describes what the
   screenshot actually shows.

The browser-chrome frame and the fixed `aspect-[16/10]` box are shared by both
modes, so the swap causes no layout shift. Once a real screenshot is in place,
consider dropping the "Example workflow" caption — it exists to stop the
illustration being mistaken for the real product.

Use a workflow with realistic but non-sensitive content. No customer names, no
internal hostnames, no live credentials or tokens in the frame.
