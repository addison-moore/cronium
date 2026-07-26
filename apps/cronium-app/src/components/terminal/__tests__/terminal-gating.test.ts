import {
  canInitializeTerminal,
  type TerminalGateInputs,
} from "@/components/terminal/terminal-gating";

const READY: TerminalGateInputs = {
  isClient: true,
  hasContainer: true,
  isUserLoading: false,
  hasUser: true,
};

describe("canInitializeTerminal", () => {
  it("allows initialization only when every prerequisite is satisfied", () => {
    expect(canInitializeTerminal(READY)).toBe(true);
  });

  it("blocks during SSR (not yet client-mounted)", () => {
    expect(canInitializeTerminal({ ...READY, isClient: false })).toBe(false);
  });

  it("blocks while the container div is not rendered", () => {
    expect(canInitializeTerminal({ ...READY, hasContainer: false })).toBe(
      false,
    );
  });

  it("blocks while auth is still resolving", () => {
    expect(canInitializeTerminal({ ...READY, isUserLoading: true })).toBe(
      false,
    );
  });

  it("blocks when there is no authenticated user", () => {
    expect(canInitializeTerminal({ ...READY, hasUser: false })).toBe(false);
  });

  it("blocks when auth is loading even if a stale user object is present", () => {
    expect(canInitializeTerminal({ ...READY, isUserLoading: true })).toBe(
      false,
    );
    expect(
      canInitializeTerminal({
        ...READY,
        isUserLoading: true,
        hasUser: true,
      }),
    ).toBe(false);
  });
});
