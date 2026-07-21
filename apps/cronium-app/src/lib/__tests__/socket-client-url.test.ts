import { resolveSocketClientUrl } from "../socket-client-url";

describe("socket client URL", () => {
  it("uses the same origin for a public deployment", () => {
    expect(
      resolveSocketClientUrl(
        {
          protocol: "https:",
          hostname: "cronium.example",
          origin: "https://cronium.example",
        },
        undefined,
        undefined,
      ),
    ).toBe("https://cronium.example");
  });

  it("uses the loopback socket port for local development", () => {
    expect(
      resolveSocketClientUrl(
        {
          protocol: "http:",
          hostname: "localhost",
          origin: "http://localhost:5001",
        },
        undefined,
        "5102",
      ),
    ).toBe("http://localhost:5102");
  });

  it("uses the proxied origin for HTTPS loopback deployments", () => {
    expect(
      resolveSocketClientUrl(
        {
          protocol: "https:",
          hostname: "localhost",
          origin: "https://localhost",
        },
        undefined,
        "5002",
      ),
    ).toBe("https://localhost");
  });

  it("honors an explicit build-time URL", () => {
    expect(
      resolveSocketClientUrl(
        {
          protocol: "https:",
          hostname: "cronium.example",
          origin: "https://cronium.example",
        },
        "https://socket.example/",
      ),
    ).toBe("https://socket.example");
  });
});
