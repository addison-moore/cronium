/**
 * @jest-environment node
 */
jest.mock("@/lib/email", () => ({ sendEmailDetailed: jest.fn() }));

import { sendEmailDetailed } from "@/lib/email";
import { emailActions } from "../actions";
import type { ExecutionContext } from "@/tools/types/tool-plugin";

const mockSend = sendEmailDetailed as jest.Mock;
const action = emailActions.find((a) => a.id === "send-email")!;
const credentials = {
  smtpHost: "smtp.example.com",
  smtpPort: 587,
  smtpUser: "u",
  smtpPassword: "p",
  fromEmail: "from@example.com",
  enableSSL: false,
};
const context = {
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
} as unknown as ExecutionContext;

beforeEach(() => {
  mockSend.mockReset();
  mockSend.mockResolvedValue({
    accepted: ["a@example.com"],
    rejected: [],
    messageId: "1",
  });
});

describe("send-email templateEncoding", () => {
  it("escapes values in an HTML body, which is the default", () => {
    expect(action.templateEncoding!("body", {})).toBe("html");
    expect(action.templateEncoding!("body", { isHtml: true })).toBe("html");
  });

  it("leaves a plain-text body and the other fields verbatim", () => {
    expect(action.templateEncoding!("body", { isHtml: false })).toBe("text");
    expect(action.templateEncoding!("subject", {})).toBe("text");
    expect(action.templateEncoding!("to", {})).toBe("text");
  });
});

describe("send-email plain-text bodies", () => {
  it("sends the text as written and escapes it for the HTML alternative", async () => {
    await action.execute(
      credentials,
      {
        to: "a@example.com",
        subject: "s",
        body: `a < b & <script>x</script>\n"c"`,
        isHtml: false,
      },
      context,
    );

    const message = mockSend.mock.calls[0]?.[0] as {
      text: string;
      html: string;
    };
    expect(message.text).toBe(`a < b & <script>x</script>\n"c"`);
    expect(message.html).toBe(
      "<p>a &lt; b &amp; &lt;script&gt;x&lt;/script&gt;<br>&quot;c&quot;</p>",
    );
  });
});
