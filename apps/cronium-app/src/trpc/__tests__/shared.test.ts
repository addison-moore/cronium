import { TRPCClientError } from "@trpc/client";
import { trpcErrorMessage } from "../shared";

function clientError(message: string, zodError: unknown = null) {
  return TRPCClientError.from({
    error: {
      message,
      code: -32600,
      data: { code: "BAD_REQUEST", httpStatus: 400, zodError },
    },
  });
}

describe("trpcErrorMessage", () => {
  it("gives the server's message", () => {
    expect(trpcErrorMessage(clientError("Event not found"), "Fallback")).toBe(
      "Event not found",
    );
  });

  it("gives a validation failure's sentences, not its JSON", () => {
    const error = clientError('[{"code":"custom","message":"Name is taken"}]', {
      formErrors: ["Name is taken"],
      fieldErrors: {
        serverId: ["Server selection is required"],
        tags: ["Too many tags", "Tag too long"],
      },
    });

    expect(trpcErrorMessage(error, "Fallback")).toBe(
      "Name is taken; Server selection is required; Too many tags; Tag too long",
    );
  });

  it("gives the message when zodError has no sentences in it", () => {
    const error = clientError("Bad input", { formErrors: [], fieldErrors: {} });

    expect(trpcErrorMessage(error, "Fallback")).toBe("Bad input");
  });

  it("gives the message of a failure that isn't from the server", () => {
    expect(trpcErrorMessage(new TypeError("Failed to fetch"), "Fallback")).toBe(
      "Failed to fetch",
    );
  });

  it.each([[clientError("")], [undefined], [null], ["a string"], [42], [{}]])(
    "falls back when there's nothing to say: %p",
    (error) => {
      expect(trpcErrorMessage(error, "Fallback")).toBe("Fallback");
    },
  );
});
