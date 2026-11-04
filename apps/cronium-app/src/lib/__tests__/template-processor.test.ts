import {
  TemplateProcessor,
  type TemplateContext,
  type TemplateEncoding,
} from "../template-processor";

const processor = new TemplateProcessor();

const context: TemplateContext = {
  event: { id: 1, name: "e", status: "success" },
  variables: { token: "abc==" },
  input: {
    url: "https://x.test/?a=1&b=2",
    quote: `he said "hi", it's`,
    multiline: "one\ntwo",
    rows: [
      { id: 1, name: "a" },
      { id: 2, name: `b"c` },
    ],
    obj: { a: 1 },
    n: 42,
    zero: 0,
    flag: false,
    html: `<img src=x onerror="alert(1)">`,
  },
  conditions: {},
};

const render = (template: string, encoding?: TemplateEncoding) =>
  processor.processTemplate(template, context, encoding);

describe("text encoding", () => {
  it.each([
    ["Bearer {{cronium.getVariables.token}}", "Bearer abc=="],
    ["{{cronium.input.url}}", "https://x.test/?a=1&b=2"],
    ["{{cronium.input.quote}}", `he said "hi", it's`],
  ])("uses %s verbatim", (template, expected) => {
    expect(render(template, "text")).toBe(expected);
  });

  it("always returns a string, including for a lone tag", () => {
    expect(render("{{cronium.input.n}}", "text")).toBe("42");
    expect(render("{{cronium.input.zero}}", "text")).toBe("0");
    expect(render("{{cronium.input.flag}}", "text")).toBe("false");
    expect(render("{{cronium.input.missing}}", "text")).toBe("");
  });
});

describe("objects and arrays", () => {
  it("render as JSON instead of [object Object]", () => {
    expect(render("rows: {{cronium.input.rows}}", "text")).toBe(
      `rows: ${JSON.stringify(context.input.rows)}`,
    );
    expect(render("{{cronium.input.obj}}", "text")).toBe('{"a":1}');
  });

  it("can still be walked", () => {
    expect(
      render(
        "{{#each cronium.input.rows}}{{this.id}},{{/each}}|{{cronium.input.rows.0.name}}",
        "text",
      ),
    ).toBe("1,2,|a");
  });

  it("are escaped like anything else in HTML", () => {
    expect(render("{{cronium.input.obj}}")).toBe("{&quot;a&quot;:1}");
  });

  it("do not show their stringifier to a template", () => {
    expect(render(`{{lookup cronium.input.obj "toString"}}`, "text")).toBe("");
    expect(
      render(`{{#each cronium.input.obj}}{{@key}}={{this}};{{/each}}`, "text"),
    ).toBe("a=1;");
    expect(render("{{json cronium.input.obj}}", "text")).toBe(
      JSON.stringify({ a: 1 }, null, 2),
    );
  });
});

describe("html encoding", () => {
  it("is the default and neutralizes markup", () => {
    expect(render("<p>{{cronium.input.html}}</p>")).toBe(
      "<p>&lt;img src&#x3D;x onerror&#x3D;&quot;alert(1)&quot;&gt;</p>",
    );
  });
});

describe("markup encoding", () => {
  it("encodes only what Slack and Teams decode", () => {
    expect(render("{{cronium.input.html}} a=b 'c' & d", "markup")).toBe(
      `&lt;img src=x onerror="alert(1)"&gt; a=b 'c' & d`,
    );
  });

  it("leaves the author's own markup alone", () => {
    expect(
      render("<https://x.test|link> {{cronium.getVariables.token}}", "markup"),
    ).toBe("<https://x.test|link> abc==");
  });

  it("reaches values inside objects", () => {
    expect(render('{{lookup cronium.input "html"}}', "markup")).toContain(
      "&lt;img",
    );
  });
});

describe("JSON documents", () => {
  const parse = (template: string) =>
    JSON.parse(render(template, "text")) as Record<string, unknown>;

  it("stays valid when a value holds quotes or newlines", () => {
    expect(
      parse(
        '{"q": "{{cronium.input.quote}}", "m": "{{cronium.input.multiline}}"}',
      ),
    ).toEqual({ q: `he said "hi", it's`, m: "one\ntwo" });
  });

  it("cannot have fields added by a value", () => {
    const hostile: TemplateContext = {
      ...context,
      input: { v: `x","admin":"true` },
    };
    const output = processor.processTemplate(
      '{"name": "{{cronium.input.v}}"}',
      hostile,
      "text",
    );
    expect(JSON.parse(output)).toEqual({ name: `x","admin":"true` });
  });

  it("embeds typed values for a bare tag", () => {
    expect(
      parse(
        '{"n": {{cronium.input.n}}, "rows": {{cronium.input.rows}}, "flag": {{cronium.input.flag}}}',
      ),
    ).toEqual({ n: 42, rows: context.input.rows, flag: false });
  });

  it("quotes a bare tag holding a string, so it cannot add fields", () => {
    const hostile: TemplateContext = {
      ...context,
      input: { v: `1,"admin":true` },
    };
    const output = processor.processTemplate(
      '{"n": {{cronium.input.v}}}',
      hostile,
      "text",
    );
    expect(JSON.parse(output)).toEqual({ n: `1,"admin":true` });
  });

  it("renders objects inside a string as a string", () => {
    expect(parse('{"prompt": "rows: {{cronium.input.rows}}"}')).toEqual({
      prompt: `rows: ${JSON.stringify(context.input.rows)}`,
    });
  });

  it("works in arrays and for keys", () => {
    expect(
      JSON.parse(render('["{{cronium.input.quote}}", 1]', "text")),
    ).toEqual([`he said "hi", it's`, 1]);
    expect(parse('{"{{cronium.input.n}}": true}')).toEqual({ "42": true });
  });

  it("leaves everything between the tags exactly as written", () => {
    const template =
      '{ "id": 12345678901234567890,\n  "n": "{{cronium.input.n}}" }';
    expect(render(template, "text")).toBe(
      '{ "id": 12345678901234567890,\n  "n": "42" }',
    );
  });

  it("does not mistake other text starting with a brace for JSON", () => {
    expect(render("{{cronium.input.n}} items", "text")).toBe("42 items");
    expect(render("{{cronium.input.url}}/path", "text")).toBe(
      "https://x.test/?a=1&b=2/path",
    );
  });

  it("falls back to plain rendering for a document built with block helpers", () => {
    expect(
      render(
        '[{{#each cronium.input.rows}}{{this.id}},{{/each}}"end"]',
        "text",
      ),
    ).toBe('[1,2,"end"]');
  });
});

describe("processTemplate", () => {
  it("returns text with no tags untouched", () => {
    const template = '{ "a": 12345678901234567890 } & <b>';
    expect(render(template, "text")).toBe(template);
    expect(render(template)).toBe(template);
  });

  it("throws on a template that does not compile", () => {
    expect(() => render("{{#if broken", "text")).toThrow();
  });
});
