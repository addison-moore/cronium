import React from "react";

/**
 * Render Slack-style markdown as safe React nodes (security plan Phase 1.6,
 * HI-20 / audit-2 L1).
 *
 * The previous implementation built an HTML string with regex substitutions
 * and injected it via `dangerouslySetInnerHTML`, so any HTML in the message
 * body (`<img onerror=...>`, `<script>`, event-handler attributes) executed as
 * stored XSS. This renderer never produces HTML strings: message text becomes
 * React text nodes (which React escapes), and the only elements created are the
 * fixed formatting tags below. There is no path from message content to raw
 * markup.
 */

type Segment = {
  pattern: RegExp;
  render: (inner: React.ReactNode) => React.ReactNode;
};

// Inline formatting, applied in order. Each captures a single non-greedy group.
const INLINE_RULES: Segment[] = [
  {
    pattern: /`([^`]+?)`/,
    render: (i) => <code className="rounded bg-slate-700 px-1">{i}</code>,
  },
  { pattern: /\*([^*]+?)\*/, render: (i) => <strong>{i}</strong> },
  { pattern: /_([^_]+?)_/, render: (i) => <em>{i}</em> },
  { pattern: /~([^~]+?)~/, render: (i) => <del>{i}</del> },
];

/** Recursively apply inline rules to a plain string, returning React nodes. */
function renderInline(text: string, keyPrefix: string): React.ReactNode[] {
  for (const rule of INLINE_RULES) {
    const match = rule.pattern.exec(text);
    if (match?.index === undefined) continue;

    const before = text.slice(0, match.index);
    const inner = match[1] ?? "";
    const after = text.slice(match.index + match[0].length);

    return [
      ...renderInline(before, `${keyPrefix}b`),
      <React.Fragment key={`${keyPrefix}m`}>
        {rule.render(renderInline(inner, `${keyPrefix}i`))}
      </React.Fragment>,
      ...renderInline(after, `${keyPrefix}a`),
    ];
  }
  // No further formatting: return the raw string (React escapes it on render).
  return text.length > 0 ? [text] : [];
}

/**
 * Parse a Slack message into React nodes. Fenced code blocks (```…```) are
 * rendered verbatim inside <pre> (no inline formatting); everything else gets
 * inline formatting with newlines as <br />.
 */
export function formatSlackMessage(message: string): React.ReactNode {
  if (!message) return null;

  const blocks = message.split(/(```[\s\S]*?```)/);
  return blocks.map((block, blockIndex) => {
    const fenced = /^```([\s\S]*?)```$/.exec(block);
    if (fenced) {
      return (
        <pre
          key={`p${blockIndex}`}
          className="mt-2 rounded bg-slate-700 p-2 whitespace-pre-wrap"
        >
          {fenced[1] ?? ""}
        </pre>
      );
    }
    if (block.length === 0) return null;

    // Inline segments, splitting on newlines into <br />-separated lines.
    const lines = block.split("\n");
    return (
      <React.Fragment key={`t${blockIndex}`}>
        {lines.map((line, lineIndex) => (
          <React.Fragment key={`l${blockIndex}-${lineIndex}`}>
            {lineIndex > 0 && <br />}
            {renderInline(line, `s${blockIndex}-${lineIndex}-`)}
          </React.Fragment>
        ))}
      </React.Fragment>
    );
  });
}
