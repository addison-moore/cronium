import { TEMPLATE_VARIABLES, appendTemplateVariable } from "../template-form";

describe("appendTemplateVariable", () => {
  it("appends a handlebars placeholder to an existing string value", () => {
    const params = { message: "Job done: " };
    const next = appendTemplateVariable(
      params,
      "message",
      "cronium.event.name",
    );
    expect(next.message).toBe("Job done: {{cronium.event.name}}");
  });

  it("does not mutate the input object and preserves other keys", () => {
    const params = { message: "a", subject: "s" };
    const next = appendTemplateVariable(params, "message", "cronium.event.id");
    expect(params).toEqual({ message: "a", subject: "s" });
    expect(next).not.toBe(params);
    expect(next.subject).toBe("s");
  });

  it("starts from an empty string when the field is missing", () => {
    const next = appendTemplateVariable({}, "body", "cronium.input.payload");
    expect(next.body).toBe("{{cronium.input.payload}}");
  });

  it("starts from an empty string when the field is null", () => {
    const next = appendTemplateVariable(
      { body: null },
      "body",
      "cronium.event.status",
    );
    expect(next.body).toBe("{{cronium.event.status}}");
  });

  it("accumulates placeholders across repeated insertions", () => {
    let params: Record<string, unknown> = { text: "" };
    params = appendTemplateVariable(params, "text", "cronium.event.name");
    params = appendTemplateVariable(params, "text", "cronium.event.status");
    expect(params.text).toBe("{{cronium.event.name}}{{cronium.event.status}}");
  });

  it("string-coerces a non-string current value (pinned quirk)", () => {
    // The historical implementation concatenates with `+`, so objects become
    // "[object Object]..." and numbers are stringified. Pinned, not endorsed.
    const fromObject = appendTemplateVariable(
      { blocks: { a: 1 } },
      "blocks",
      "cronium.input.x",
    );
    expect(fromObject.blocks).toBe("[object Object]{{cronium.input.x}}");

    const fromNumber = appendTemplateVariable(
      { count: 5 },
      "count",
      "cronium.input.x",
    );
    expect(fromNumber.count).toBe("5{{cronium.input.x}}");
  });
});

describe("TEMPLATE_VARIABLES", () => {
  it("exposes the four documented variable groups", () => {
    expect(TEMPLATE_VARIABLES.map((g) => g.group)).toEqual([
      "Event",
      "Variables",
      "Input",
      "Conditions",
    ]);
  });

  it("includes the workflow-input placeholder", () => {
    const names = TEMPLATE_VARIABLES.flatMap((g) =>
      g.variables.map((v) => v.name),
    );
    expect(names).toContain("cronium.input.*");
    expect(names).toContain("cronium.event.output");
  });
});
