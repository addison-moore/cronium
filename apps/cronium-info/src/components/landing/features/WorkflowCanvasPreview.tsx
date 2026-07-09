/**
 * The workflow canvas visual.
 *
 * Today this renders a hand-drawn SVG diagram. To swap in a real screenshot or
 * GIF of the product:
 *
 *   1. Drop the capture at `public/assets/product/workflow-canvas.png`
 *   2. Change CANVAS_MODE below to "image"
 *
 * The chrome frame and the aspect-ratio box are shared by both modes, so the
 * swap causes no layout shift. Keep CANVAS_ALT in sync with what the visual
 * actually shows.
 */
const CANVAS_MODE: "svg" | "image" = "svg";

const CANVAS_SRC = "/assets/product/workflow-canvas.png";

const CANVAS_ALT =
  "Example Cronium workflow: a scheduled database backup that, on success, uploads to S3 and prunes old backups before notifying Slack, and on failure alerts the on-call engineer.";

export default function WorkflowCanvasPreview() {
  return (
    <figure className="m-0">
      <div className="border-border bg-card overflow-hidden rounded-xl border shadow-xl">
        {/* Window chrome. Purely decorative — it frames the visual as product UI. */}
        <div
          aria-hidden="true"
          className="border-border bg-muted/40 flex items-center gap-2 border-b px-4 py-3"
        >
          <span className="bg-muted-foreground/30 h-2.5 w-2.5 rounded-full" />
          <span className="bg-muted-foreground/30 h-2.5 w-2.5 rounded-full" />
          <span className="bg-muted-foreground/30 h-2.5 w-2.5 rounded-full" />
          <span className="bg-background text-muted-foreground border-border ml-3 truncate rounded-md border px-2 py-0.5 text-xs">
            cronium — nightly-backup
          </span>
        </div>

        {/* Fixed aspect box: identical in both modes, so no CLS on swap. */}
        <div className="bg-background aspect-[16/10] w-full">
          {CANVAS_MODE === "image" ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={CANVAS_SRC}
              alt={CANVAS_ALT}
              className="h-full w-full object-cover"
            />
          ) : (
            <WorkflowCanvasSvg />
          )}
        </div>
      </div>

      {/* Say plainly that this is an illustration, not a live dashboard. */}
      <figcaption className="text-muted-foreground mt-3 text-center text-xs">
        Example workflow
      </figcaption>
    </figure>
  );
}

const NODE_W = 132;
const NODE_H = 48;

type Accent = "success" | "failure" | undefined;

/** Node box + label. Colours come from theme tokens, never hardcoded hex. */
function Node({
  x,
  y,
  label,
  sub,
  accent,
}: {
  x: number;
  y: number;
  label: string;
  sub: string;
  accent?: Accent;
}) {
  const stroke =
    accent === "success"
      ? "stroke-green-500 dark:stroke-green-400"
      : accent === "failure"
        ? "stroke-red-500 dark:stroke-red-400"
        : "stroke-border";

  return (
    <g>
      <rect
        x={x}
        y={y}
        width={NODE_W}
        height={NODE_H}
        rx={8}
        className={`fill-card ${stroke}`}
        strokeWidth={1.5}
      />
      <text
        x={x + 12}
        y={y + 21}
        className="fill-card-foreground text-[11px] font-semibold"
      >
        {label}
      </text>
      <text x={x + 12} y={y + 36} className="fill-muted-foreground text-[9px]">
        {sub}
      </text>
    </g>
  );
}

/** Edge label chip, so branch semantics read without relying on colour alone. */
function EdgeLabel({
  x,
  y,
  text,
  tone,
}: {
  x: number;
  y: number;
  text: string;
  tone: "success" | "failure";
}) {
  const cls =
    tone === "success"
      ? "fill-green-600 dark:fill-green-400"
      : "fill-red-600 dark:fill-red-400";
  return (
    <text x={x} y={y} className={`${cls} text-[8px] font-medium tracking-wide`}>
      {text}
    </text>
  );
}

function WorkflowCanvasSvg() {
  return (
    <svg
      viewBox="0 0 720 400"
      preserveAspectRatio="xMidYMid meet"
      className="h-full w-full"
      role="img"
      aria-labelledby="workflow-canvas-title"
    >
      <title id="workflow-canvas-title">{CANVAS_ALT}</title>

      <defs>
        {/* Dot grid, echoing the real React Flow canvas background. */}
        <pattern
          id="canvas-dots"
          width={16}
          height={16}
          patternUnits="userSpaceOnUse"
        >
          <circle cx={1} cy={1} r={1} className="fill-muted-foreground/25" />
        </pattern>
        <marker
          id="arrow-neutral"
          markerWidth={8}
          markerHeight={8}
          refX={7}
          refY={3}
          orient="auto"
        >
          <path d="M0,0 L0,6 L7,3 z" className="fill-muted-foreground" />
        </marker>
        <marker
          id="arrow-success"
          markerWidth={8}
          markerHeight={8}
          refX={7}
          refY={3}
          orient="auto"
        >
          <path
            d="M0,0 L0,6 L7,3 z"
            className="fill-green-500 dark:fill-green-400"
          />
        </marker>
        <marker
          id="arrow-failure"
          markerWidth={8}
          markerHeight={8}
          refX={7}
          refY={3}
          orient="auto"
        >
          <path
            d="M0,0 L0,6 L7,3 z"
            className="fill-red-500 dark:fill-red-400"
          />
        </marker>
      </defs>

      <rect width={720} height={400} fill="url(#canvas-dots)" />

      {/* Trigger -> Backup */}
      <path
        d="M148 176 H 184"
        className="stroke-muted-foreground"
        strokeWidth={1.5}
        fill="none"
        markerEnd="url(#arrow-neutral)"
      />

      {/* Backup -> Upload to S3 (success) */}
      <path
        d="M324 166 C 348 166, 340 100, 360 100"
        className="stroke-green-500 dark:stroke-green-400"
        strokeWidth={1.5}
        fill="none"
        markerEnd="url(#arrow-success)"
      />
      {/* Backup -> Prune old backups (success, parallel branch) */}
      <path
        d="M324 184 C 348 184, 340 200, 360 200"
        className="stroke-green-500 dark:stroke-green-400"
        strokeWidth={1.5}
        fill="none"
        markerEnd="url(#arrow-success)"
      />
      {/* Backup -> Alert on-call (failure) */}
      <path
        d="M324 194 C 348 194, 340 310, 360 310"
        className="stroke-red-500 dark:stroke-red-400"
        strokeWidth={1.5}
        fill="none"
        markerEnd="url(#arrow-failure)"
      />
      {/* Upload to S3 -> Notify #ops */}
      <path
        d="M500 100 H 540"
        className="stroke-green-500 dark:stroke-green-400"
        strokeWidth={1.5}
        fill="none"
        markerEnd="url(#arrow-success)"
      />

      <EdgeLabel x={330} y={122} text="ON_SUCCESS" tone="success" />
      <EdgeLabel x={330} y={222} text="ON_SUCCESS" tone="success" />
      <EdgeLabel x={330} y={268} text="ON_FAILURE" tone="failure" />

      <Node x={16} y={152} label="Daily 02:00" sub="Schedule · cron" />
      <Node x={192} y={152} label="Backup DB" sub="Python script" />
      <Node
        x={368}
        y={76}
        label="Upload to S3"
        sub="Bash script"
        accent="success"
      />
      <Node
        x={368}
        y={176}
        label="Prune backups"
        sub="Bash script"
        accent="success"
      />
      <Node
        x={368}
        y={286}
        label="Alert on-call"
        sub="Email · Discord"
        accent="failure"
      />
      <Node
        x={548}
        y={76}
        label="Notify #ops"
        sub="Slack message"
        accent="success"
      />
    </svg>
  );
}
