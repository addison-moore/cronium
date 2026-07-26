import {
  deriveParameterPreview,
  resolvePreviewContext,
} from "../template-preview";
import { createTemplateContext } from "@/lib/template-processor";
import { type TemplateContext } from "@/lib/template-processor";
import { processToolActionTemplate } from "@/lib/tool-action-template-processor";

const successContext = createTemplateContext(
  {
    id: 123,
    name: "Daily Backup Task",
    status: "success",
    output: "Backup completed",
  },
  { appName: "MyApp" },
  { orderId: "ord-42" },
);

const failureContext = createTemplateContext({
  id: 124,
  name: "Database Migration",
  status: "failure",
  error: "Connection timeout",
});

describe("resolvePreviewContext", () => {
  it("returns the selected sample context when custom context is off", () => {
    expect(
      resolvePreviewContext({
        useCustomContext: false,
        customContext: '{"anything": true}',
        selectedContext: "success",
        successContext,
        failureContext,
      }),
    ).toBe(successContext);

    expect(
      resolvePreviewContext({
        useCustomContext: false,
        customContext: "",
        selectedContext: "failure",
        successContext,
        failureContext,
      }),
    ).toBe(failureContext);
  });

  it("parses custom JSON when enabled", () => {
    expect(
      resolvePreviewContext({
        useCustomContext: true,
        customContext: '{"event":{"name":"Custom"}}',
        selectedContext: "success",
        successContext,
        failureContext,
      }),
    ).toEqual({ event: { name: "Custom" } });
  });

  it("falls back to the selected sample context when custom JSON is empty", () => {
    expect(
      resolvePreviewContext({
        useCustomContext: true,
        customContext: "",
        selectedContext: "failure",
        successContext,
        failureContext,
      }),
    ).toBe(failureContext);
  });

  it("falls back to the selected sample context when custom JSON is invalid", () => {
    const errorSpy = jest
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    try {
      expect(
        resolvePreviewContext({
          useCustomContext: true,
          customContext: "{not json",
          selectedContext: "success",
          successContext,
          failureContext,
        }),
      ).toBe(successContext);
      expect(errorSpy).toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
    }
  });
});

describe("deriveParameterPreview", () => {
  it("reports no change when processing left the value alone", () => {
    const preview = deriveParameterPreview("static text", "static text");
    expect(preview).toEqual({
      originalStr: "static text",
      processedStr: "static text",
      hasChanged: false,
    });
  });

  it("reports a change when the processed value differs", () => {
    const preview = deriveParameterPreview("Hello {{cronium.x}}", "Hello 1");
    expect(preview.hasChanged).toBe(true);
    expect(preview.originalStr).toBe("Hello {{cronium.x}}");
    expect(preview.processedStr).toBe("Hello 1");
  });

  it("pretty-prints non-string values as JSON", () => {
    const preview = deriveParameterPreview({ a: 1 }, { a: 2 });
    expect(preview.originalStr).toBe('{\n  "a": 1\n}');
    expect(preview.processedStr).toBe('{\n  "a": 2\n}');
    expect(preview.hasChanged).toBe(true);
  });

  it("yields undefined strings for undefined values (pinned quirk)", () => {
    // JSON.stringify(undefined) is undefined, not a string; preserved from
    // the original component so the DOM shows an empty textarea.
    const preview = deriveParameterPreview(undefined, undefined);
    expect(preview.originalStr).toBeUndefined();
    expect(preview.processedStr).toBeUndefined();
    expect(preview.hasChanged).toBe(false);
  });
});

describe("preview pipeline (interpolation through the resolved context)", () => {
  it("interpolates event and input placeholders into parameters", () => {
    const context = resolvePreviewContext({
      useCustomContext: false,
      customContext: "",
      selectedContext: "success",
      successContext,
      failureContext,
    }) as TemplateContext;

    const processed = processToolActionTemplate(
      {
        parameters: {
          message: "{{cronium.event.name}} finished: {{cronium.event.status}}",
          order: "Order {{cronium.input.orderId}}",
          retries: 3,
        },
      },
      context,
    );

    expect(processed.parameters.message).toBe(
      "Daily Backup Task finished: success",
    );
    expect(processed.parameters.order).toBe("Order ord-42");
    // Non-string parameters pass through untouched
    expect(processed.parameters.retries).toBe(3);

    const preview = deriveParameterPreview(
      "Order {{cronium.input.orderId}}",
      processed.parameters.order,
    );
    expect(preview.hasChanged).toBe(true);
    expect(preview.processedStr).toBe("Order ord-42");
  });

  it("renders unknown placeholders as empty strings (Handlebars default)", () => {
    const processed = processToolActionTemplate(
      { parameters: { message: "v=[{{cronium.input.missing}}]" } },
      successContext,
    );
    expect(processed.parameters.message).toBe("v=[]");
  });
});
