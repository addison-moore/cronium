/**
 * @jest-environment node
 */
jest.mock("ioredis", () => {
  const client = {
    connect: jest.fn().mockResolvedValue(undefined),
    ping: jest.fn().mockResolvedValue("PONG"),
    set: jest.fn().mockResolvedValueOnce("OK").mockResolvedValueOnce(null),
    disconnect: jest.fn(),
    on: jest.fn(),
  };
  return {
    __esModule: true,
    default: jest.fn(() => client),
    mockClient: client,
  };
});

const redisMock = jest.requireMock("ioredis") as {
  default: jest.Mock;
  mockClient: {
    set: jest.Mock;
  };
};

import {
  closeSocketSecurityStore,
  consumeSocketTicketOnce,
} from "../socket-security-store";

describe("shared socket replay protection", () => {
  beforeAll(() => {
    process.env.VALKEY_URL = "valkey://security-store.test:6379";
  });

  afterAll(async () => {
    await closeSocketSecurityStore();
    delete process.env.VALKEY_URL;
  });

  it("uses an expiring atomic NX write and rejects a duplicate", async () => {
    await expect(
      consumeSocketTicketOnce("ticket-id", 1_030, 1_000),
    ).resolves.toBe(true);
    await expect(
      consumeSocketTicketOnce("ticket-id", 1_030, 1_000),
    ).resolves.toBe(false);

    expect(redisMock.default).toHaveBeenCalledWith(
      "redis://security-store.test:6379",
      expect.any(Object),
    );

    expect(redisMock.mockClient.set).toHaveBeenNthCalledWith(
      1,
      "cronium:socket-ticket:consumed:ticket-id",
      "1",
      "EX",
      30,
      "NX",
    );
    expect(redisMock.mockClient.set).toHaveBeenNthCalledWith(
      2,
      "cronium:socket-ticket:consumed:ticket-id",
      "1",
      "EX",
      30,
      "NX",
    );
  });

  it("rejects expired tickets without contacting Valkey", async () => {
    await expect(consumeSocketTicketOnce("expired", 999, 1_000)).resolves.toBe(
      false,
    );
    expect(redisMock.mockClient.set).toHaveBeenCalledTimes(2);
  });
});
