import { TemplateProcessor, type TemplateContext } from "../template-processor";

/**
 * Regression for Phase 4.3: the Handlebars `lookup` helper must never return
 * prototype-chain properties, even though the field name is user-controlled.
 */
describe("TemplateProcessor lookup helper — prototype safety", () => {
  const processor = new TemplateProcessor();

  const context: TemplateContext = {
    event: { id: 1, name: "e", status: "success" },
    variables: { real: "value" },
    input: {},
    conditions: {},
  };

  it("returns own properties normally", () => {
    const out = processor.processTemplate(
      `{{lookup cronium.getVariables "real"}}`,
      context,
    );
    expect(out).toBe("value");
  });

  it.each(["__proto__", "constructor", "prototype"])(
    "does not expose the %s key",
    (key) => {
      const out = processor.processTemplate(
        `{{lookup cronium.getVariables "${key}"}}`,
        context,
      );
      // Must render empty (undefined), not "[object Object]" or a function.
      expect(out).toBe("");
    },
  );

  it("does not expose inherited (non-own) properties", () => {
    const out = processor.processTemplate(
      `{{lookup cronium.getVariables "toString"}}`,
      context,
    );
    expect(out).toBe("");
  });
});
