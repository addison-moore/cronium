import { renderToStaticMarkup } from "react-dom/server";

import { formatSlackMessage } from "../format-slack-message";

function html(message: string): string {
  return renderToStaticMarkup(<>{formatSlackMessage(message)}</>);
}

describe("formatSlackMessage — XSS safety (HI-20 / L1)", () => {
  it("escapes raw HTML in the message body", () => {
    const out = html("<img src=x onerror=alert(1)>");
    // No live <img> element and no unescaped event-handler attribute: the
    // payload is inert escaped text. (The literal string "onerror" surviving
    // inside `&lt;img … onerror=…&gt;` is harmless — it is text, not markup.)
    expect(out).not.toContain("<img");
    expect(out).not.toMatch(/<[^>]*onerror=/i);
    expect(out).toContain("&lt;img");
  });

  it("escapes a script tag", () => {
    const out = html("<script>alert(document.cookie)</script>");
    expect(out).not.toContain("<script>");
    expect(out).toContain("&lt;script&gt;");
  });

  it("does not emit an event-handler attribute smuggled through bold syntax", () => {
    // The old regex turned *...* into <strong>...</strong> without escaping,
    // so `*<img onerror=x>*` produced live markup. Now it is inert.
    const out = html("*<img src=x onerror=alert(1)>*");
    expect(out).toContain("<strong>");
    expect(out).not.toContain("<img");
    expect(out).not.toMatch(/<[^>]*onerror=/i);
    expect(out).toContain("&lt;img");
  });

  it("neutralizes a javascript: link payload (rendered as text)", () => {
    const out = html('<a href="javascript:alert(1)">click</a>');
    expect(out).not.toContain("<a ");
    expect(out).toContain("&lt;a");
  });
});

describe("formatSlackMessage — formatting still works", () => {
  it("renders bold/italic/strike/code as safe elements", () => {
    const out = html("*b* _i_ ~s~ `c`");
    expect(out).toContain("<strong>b</strong>");
    expect(out).toContain("<em>i</em>");
    expect(out).toContain("<del>s</del>");
    expect(out).toContain("<code");
    expect(out).toContain(">c</code>");
  });

  it("renders fenced code blocks verbatim without inner formatting", () => {
    const out = html("```*not bold*```");
    expect(out).toContain("<pre");
    expect(out).toContain("*not bold*");
    expect(out).not.toContain("<strong>");
  });

  it("renders newlines as <br/>", () => {
    const out = html("line1\nline2");
    expect(out).toContain("<br");
    expect(out).toContain("line1");
    expect(out).toContain("line2");
  });

  it("escapes HTML even inside a code span", () => {
    const out = html("`<b>x</b>`");
    expect(out).toContain("<code");
    expect(out).toContain("&lt;b&gt;");
    expect(out).not.toContain("<b>x</b>");
  });
});
