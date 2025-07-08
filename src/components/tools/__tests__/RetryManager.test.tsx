import React from "react";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderHook } from "@testing-library/react";
import RetryManager, { useRetry, type RetryConfig } from "../RetryManager";

describe("useRetry Hook", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
  });

  it("executes function successfully on first attempt", async () => {
    const mockFn = jest.fn().mockResolvedValue("success");
    const { result } = renderHook(() => useRetry(mockFn));

    let response;
    await act(async () => {
      response = await result.current.execute();
    });

    expect(response).toBe("success");
    expect(mockFn).toHaveBeenCalledTimes(1);
    expect(result.current.state.attempts).toBe(1);
    expect(result.current.state.isRetrying).toBe(false);
    expect(result.current.state.lastError).toBeUndefined();
  });

  it("retries on failure with default config", async () => {
    const mockFn = jest
      .fn()
      .mockRejectedValueOnce(new Error("First failure"))
      .mockRejectedValueOnce(new Error("Second failure"))
      .mockResolvedValueOnce("success");

    const { result } = renderHook(() =>
      useRetry(mockFn, { maxAttempts: 3, initialDelay: 10 }),
    );

    let response;
    await act(async () => {
      response = await result.current.execute();
    });

    expect(response).toBe("success");
    expect(mockFn).toHaveBeenCalledTimes(3);
    expect(result.current.state.attempts).toBe(3);
    expect(result.current.state.history).toHaveLength(3);
    expect(result.current.state.history[2].success).toBe(true);
  });

  it("fails after max attempts", async () => {
    const mockFn = jest.fn().mockRejectedValue(new Error("Persistent failure"));
    const onFailure = jest.fn();

    const { result } = renderHook(() =>
      useRetry(mockFn, {
        maxAttempts: 2,
        initialDelay: 10,
        onFailure,
      }),
    );

    await expect(result.current.execute()).rejects.toThrow(
      "Persistent failure",
    );

    expect(mockFn).toHaveBeenCalledTimes(2);
    expect(onFailure).toHaveBeenCalledWith(expect.any(Error), 2);
    expect(result.current.state.attempts).toBe(2);
    expect(result.current.state.lastError?.message).toBe("Persistent failure");
  });

  describe("Retry Strategies", () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it("uses fixed delay strategy", async () => {
      const mockFn = jest
        .fn()
        .mockRejectedValueOnce(new Error("fail"))
        .mockResolvedValueOnce("success");

      const { result } = renderHook(() =>
        useRetry(mockFn, {
          strategy: "fixed",
          initialDelay: 1000,
          maxAttempts: 2,
          jitter: false,
        }),
      );

      const executePromise = result.current.execute();

      // First attempt fails immediately
      await jest.advanceTimersByTimeAsync(0);
      expect(mockFn).toHaveBeenCalledTimes(1);

      // Wait for fixed delay
      await jest.advanceTimersByTimeAsync(1000);
      expect(mockFn).toHaveBeenCalledTimes(2);

      await executePromise;
    });

    it("uses exponential backoff strategy", async () => {
      const mockFn = jest
        .fn()
        .mockRejectedValueOnce(new Error("fail 1"))
        .mockRejectedValueOnce(new Error("fail 2"))
        .mockResolvedValueOnce("success");

      const onRetryAttempt = jest.fn();

      const { result } = renderHook(() =>
        useRetry(mockFn, {
          strategy: "exponential",
          initialDelay: 100,
          backoffMultiplier: 2,
          maxAttempts: 3,
          jitter: false,
          onRetryAttempt,
        }),
      );

      const executePromise = result.current.execute();

      // First attempt
      await jest.advanceTimersByTimeAsync(0);
      expect(mockFn).toHaveBeenCalledTimes(1);

      // Second attempt after 100ms
      await jest.advanceTimersByTimeAsync(100);
      expect(mockFn).toHaveBeenCalledTimes(2);
      expect(onRetryAttempt).toHaveBeenCalledWith(2, 100);

      // Third attempt after 200ms (100 * 2)
      await jest.advanceTimersByTimeAsync(200);
      expect(mockFn).toHaveBeenCalledTimes(3);
      expect(onRetryAttempt).toHaveBeenCalledWith(3, 200);

      await executePromise;
    });

    it("applies jitter to delays", async () => {
      const mockFn = jest
        .fn()
        .mockRejectedValueOnce(new Error("fail"))
        .mockResolvedValueOnce("success");

      const { result } = renderHook(() =>
        useRetry(mockFn, {
          strategy: "fixed",
          initialDelay: 1000,
          maxAttempts: 2,
          jitter: true,
          jitterFactor: 0.5, // ±50%
        }),
      );

      const executePromise = result.current.execute();

      // First attempt
      await jest.advanceTimersByTimeAsync(0);
      expect(mockFn).toHaveBeenCalledTimes(1);

      // The delay should be between 500ms and 1500ms
      // We'll advance by the max possible to ensure it fires
      await jest.advanceTimersByTimeAsync(1500);
      expect(mockFn).toHaveBeenCalledTimes(2);

      await executePromise;
    });
  });

  it("respects retryable errors configuration", async () => {
    const retryableError = new Error("NETWORK_ERROR");
    (retryableError as any).code = "NETWORK_ERROR";

    const nonRetryableError = new Error("AUTH_ERROR");
    (nonRetryableError as any).code = "AUTH_ERROR";

    const mockFn = jest
      .fn()
      .mockRejectedValueOnce(retryableError)
      .mockResolvedValueOnce("success");

    const { result } = renderHook(() =>
      useRetry(mockFn, {
        maxAttempts: 3,
        initialDelay: 10,
        retryableErrors: ["NETWORK_ERROR"],
      }),
    );

    await act(async () => {
      await result.current.execute();
    });

    expect(mockFn).toHaveBeenCalledTimes(2);

    // Test non-retryable error
    mockFn.mockRejectedValueOnce(nonRetryableError);

    await expect(result.current.execute()).rejects.toThrow("AUTH_ERROR");
    expect(mockFn).toHaveBeenCalledTimes(3); // Only one more attempt
  });

  it("handles pause and resume", async () => {
    jest.useFakeTimers();

    const mockFn = jest
      .fn()
      .mockRejectedValueOnce(new Error("fail"))
      .mockResolvedValueOnce("success");

    const { result } = renderHook(() =>
      useRetry(mockFn, {
        maxAttempts: 2,
        initialDelay: 1000,
      }),
    );

    const executePromise = result.current.execute();

    // First attempt fails
    await jest.advanceTimersByTimeAsync(0);
    expect(mockFn).toHaveBeenCalledTimes(1);

    // Pause before retry
    act(() => {
      result.current.pause();
    });

    // Advance time - should not retry while paused
    await jest.advanceTimersByTimeAsync(2000);
    expect(mockFn).toHaveBeenCalledTimes(1);

    // Resume
    act(() => {
      result.current.resume();
    });

    // Should throw because we paused
    await expect(executePromise).rejects.toThrow("Retry paused by user");

    jest.useRealTimers();
  });

  it("resets state correctly", async () => {
    const mockFn = jest.fn().mockRejectedValue(new Error("fail"));

    const { result } = renderHook(() => useRetry(mockFn, { maxAttempts: 1 }));

    try {
      await result.current.execute();
    } catch {
      // Expected to fail
    }

    expect(result.current.state.attempts).toBe(1);
    expect(result.current.state.lastError).toBeDefined();

    act(() => {
      result.current.reset();
    });

    expect(result.current.state.attempts).toBe(0);
    expect(result.current.state.lastError).toBeUndefined();
    expect(result.current.state.history).toHaveLength(0);
  });
});

describe("RetryManager Component", () => {
  const mockOnConfigChange = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders with default configuration", () => {
    render(<RetryManager />);

    expect(screen.getByText("Retry Configuration")).toBeInTheDocument();
    expect(screen.getByLabelText("Retry Strategy")).toBeInTheDocument();
    expect(screen.getByLabelText("Max Attempts")).toBeInTheDocument();
    expect(screen.getByLabelText("Initial Delay")).toBeInTheDocument();
    expect(screen.getByLabelText("Max Delay")).toBeInTheDocument();
  });

  it("updates configuration when values change", async () => {
    render(<RetryManager onConfigChange={mockOnConfigChange} />);

    // Change strategy
    const strategySelect = screen.getByLabelText("Retry Strategy");
    await userEvent.click(strategySelect);
    await userEvent.click(screen.getByText("Linear Backoff"));

    expect(mockOnConfigChange).toHaveBeenCalledWith(
      expect.objectContaining({ strategy: "linear" }),
    );
  });

  it("shows backoff multiplier for exponential strategy", async () => {
    render(<RetryManager />);

    // Initially should show (exponential is default)
    expect(screen.getByLabelText("Backoff Multiplier")).toBeInTheDocument();

    // Change to fixed strategy
    const strategySelect = screen.getByLabelText("Retry Strategy");
    await userEvent.click(strategySelect);
    await userEvent.click(screen.getByText("Fixed Delay"));

    // Should not show backoff multiplier
    expect(
      screen.queryByLabelText("Backoff Multiplier"),
    ).not.toBeInTheDocument();
  });

  it("toggles jitter configuration", async () => {
    render(<RetryManager onConfigChange={mockOnConfigChange} />);

    const jitterSwitch = screen.getByLabelText("Add Jitter");

    // Initially enabled
    expect(screen.getByLabelText("Jitter Factor")).toBeInTheDocument();

    // Disable jitter
    await userEvent.click(jitterSwitch);

    expect(mockOnConfigChange).toHaveBeenCalledWith(
      expect.objectContaining({ jitter: false }),
    );
    expect(screen.queryByLabelText("Jitter Factor")).not.toBeInTheDocument();
  });

  it("displays delay preview correctly", () => {
    render(<RetryManager />);

    // Check delay preview section
    expect(screen.getByText("Delay Preview")).toBeInTheDocument();
    expect(screen.getByText("Attempt 1")).toBeInTheDocument();
    expect(screen.getByText("1.0s")).toBeInTheDocument(); // Default 1000ms initial delay
  });

  it("applies preset configurations", async () => {
    render(<RetryManager onConfigChange={mockOnConfigChange} />);

    // Click Conservative preset
    const conservativeButton = screen.getByRole("button", {
      name: /conservative/i,
    });
    await userEvent.click(conservativeButton);

    expect(mockOnConfigChange).toHaveBeenCalledWith(
      expect.objectContaining({
        maxAttempts: 3,
        initialDelay: 1000,
        maxDelay: 5000,
        strategy: "fixed",
        jitter: false,
      }),
    );
  });

  it("hides config when showConfig is false", () => {
    render(<RetryManager showConfig={false} />);

    expect(screen.queryByLabelText("Retry Strategy")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Max Attempts")).not.toBeInTheDocument();

    // Preset buttons should still be visible
    expect(
      screen.getByRole("button", { name: /conservative/i }),
    ).toBeInTheDocument();
  });

  it("updates slider values correctly", async () => {
    render(<RetryManager onConfigChange={mockOnConfigChange} />);

    const maxAttemptsSlider = screen.getByLabelText("Max Attempts");

    // Simulate slider change
    fireEvent.change(maxAttemptsSlider, { target: { value: "5" } });

    expect(mockOnConfigChange).toHaveBeenCalledWith(
      expect.objectContaining({ maxAttempts: 5 }),
    );
  });

  it("calculates example delays for different strategies", async () => {
    render(<RetryManager />);

    // Check exponential delays (default)
    expect(screen.getByText("Attempt 1")).toBeInTheDocument();
    expect(screen.getByText("1.0s")).toBeInTheDocument();
    expect(screen.getByText("Attempt 2")).toBeInTheDocument();
    expect(screen.getByText("2.0s")).toBeInTheDocument(); // 1000ms * 2

    // Switch to linear
    const strategySelect = screen.getByLabelText("Retry Strategy");
    await userEvent.click(strategySelect);
    await userEvent.click(screen.getByText("Linear Backoff"));

    // Linear delays should be 1s, 2s, 3s, etc.
    await waitFor(() => {
      expect(screen.getByText("1.0s")).toBeInTheDocument();
      expect(screen.getByText("2.0s")).toBeInTheDocument();
      expect(screen.getByText("3.0s")).toBeInTheDocument();
    });
  });

  it("shows jitter range in delay preview", () => {
    render(<RetryManager />);

    // With jitter enabled (default)
    expect(screen.getByText(/±0.1s/)).toBeInTheDocument(); // 10% of 1000ms
  });

  it("limits delays to maxDelay", async () => {
    render(<RetryManager />);

    // Set high backoff multiplier
    const multiplierSlider = screen.getByLabelText("Backoff Multiplier");
    fireEvent.change(multiplierSlider, { target: { value: "3" } });

    // Set low max delay
    const maxDelaySlider = screen.getByLabelText("Max Delay");
    fireEvent.change(maxDelaySlider, { target: { value: "3000" } });

    // Check that later attempts are capped at max delay
    await waitFor(() => {
      // Should see multiple 3.0s entries (capped at max)
      const delayTexts = screen.getAllByText("3.0s");
      expect(delayTexts.length).toBeGreaterThan(1);
    });
  });
});
