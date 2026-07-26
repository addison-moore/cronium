/**
 * Cronium Runtime SDK for Node.js
 *
 * This SDK provides runtime helper functions for scripts executing within the Cronium
 * containerized environment. It communicates with the Runtime API service to manage
 * variables, input/output data, and tool actions.
 */

const http = require("http");
const https = require("https");
const { URL } = require("url");

/**
 * Base error class for Cronium SDK errors
 */
class CroniumError extends Error {
  constructor(message) {
    super(message);
    this.name = "CroniumError";
  }
}

/**
 * API request error
 */
class CroniumAPIError extends CroniumError {
  constructor(statusCode, message) {
    super(`API Error (${statusCode}): ${message}`);
    this.name = "CroniumAPIError";
    this.statusCode = statusCode;
  }
}

/**
 * Request timeout error
 */
class CroniumTimeoutError extends CroniumError {
  constructor(message) {
    super(message);
    this.name = "CroniumTimeoutError";
  }
}

/**
 * Socket-level error codes that indicate a transient connection failure.
 * These are retried with the same bounded backoff as timeouts.
 */
const RETRYABLE_NETWORK_ERROR_CODES = new Set(["ECONNREFUSED", "ECONNRESET"]);

/**
 * Main Cronium client class
 */
class Cronium {
  constructor() {
    this.apiUrl = process.env.CRONIUM_RUNTIME_API || "http://localhost:8081";
    this.token = process.env.CRONIUM_EXECUTION_TOKEN;
    this.executionId = process.env.CRONIUM_EXECUTION_ID;

    if (!this.token) {
      throw new CroniumError(
        "CRONIUM_EXECUTION_TOKEN environment variable not set",
      );
    }
    if (!this.executionId) {
      throw new CroniumError(
        "CRONIUM_EXECUTION_ID environment variable not set",
      );
    }

    // Parse API URL
    this.apiUrlParsed = new URL(this.apiUrl);
    this.httpModule = this.apiUrlParsed.protocol === "https:" ? https : http;

    // Configuration
    this.maxRetries = 3;
    this.retryDelay = 1000; // ms
    this.timeout = 30000; // ms
  }

  /**
   * Make an HTTP request to the Runtime API with retry logic
   * @private
   */
  async _makeRequest(method, path, data = null) {
    const url = new URL(path, this.apiUrl);

    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      try {
        const result = await this._doRequest(method, url, data);
        return result;
      } catch (error) {
        const retryableStatus =
          error instanceof CroniumAPIError &&
          error.statusCode >= 500 &&
          // 501 means the endpoint is permanently unsupported in this
          // execution context (e.g. tool actions with no backing app route);
          // retrying cannot help, so surface the message immediately.
          error.statusCode !== 501;
        // Timeouts and transient connection failures (refused/reset) are
        // equally retryable — the service may just be restarting.
        const retryableNetwork =
          error instanceof CroniumTimeoutError ||
          RETRYABLE_NETWORK_ERROR_CODES.has(error.code);
        if (
          (retryableStatus || retryableNetwork) &&
          attempt < this.maxRetries - 1
        ) {
          await this._sleep(this.retryDelay * Math.pow(2, attempt));
          continue;
        }
        throw error;
      }
    }

    throw new CroniumError("Max retries exceeded");
  }

  /**
   * Perform the actual HTTP request
   * @private
   */
  _doRequest(method, url, data) {
    return new Promise((resolve, reject) => {
      const options = {
        hostname: url.hostname,
        port: url.port || (url.protocol === "https:" ? 443 : 80),
        path: url.pathname + url.search,
        method: method,
        headers: {
          Authorization: `Bearer ${this.token}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        timeout: this.timeout,
      };

      const req = this.httpModule.request(options, (res) => {
        let responseData = "";

        res.on("data", (chunk) => {
          responseData += chunk;
        });

        res.on("end", () => {
          let parsed = null;
          let parseError = null;
          try {
            parsed = responseData ? JSON.parse(responseData) : null;
          } catch (e) {
            parseError = e;
          }

          // HTTP errors are classified by status code even when the body is
          // not JSON (e.g. an HTML error page from a proxy) — a parse failure
          // must never mask the status or bypass 5xx retry logic.
          if (res.statusCode >= 400) {
            const message = parsed?.message || `HTTP ${res.statusCode}`;
            reject(new CroniumAPIError(res.statusCode, message));
            return;
          }

          if (parseError) {
            reject(
              new CroniumError(
                `Failed to parse response: ${parseError.message}`,
              ),
            );
            return;
          }

          if (parsed && parsed.success === false) {
            reject(
              new CroniumAPIError(
                res.statusCode,
                parsed.message || "Unknown error",
              ),
            );
            return;
          }

          resolve(parsed);
        });
      });

      req.on("error", (error) => {
        const wrapped = new CroniumError(`Request failed: ${error.message}`);
        // Preserve the socket error code so the retry logic can classify
        // transient connection failures (ECONNREFUSED/ECONNRESET).
        wrapped.code = error.code;
        reject(wrapped);
      });

      req.on("timeout", () => {
        req.destroy();
        reject(new CroniumTimeoutError("Request timed out"));
      });

      if (data) {
        req.write(JSON.stringify(data));
      }

      req.end();
    });
  }

  /**
   * Sleep for specified milliseconds
   * @private
   */
  _sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Get input data for this execution
   * @returns {Promise<any>} The input data
   */
  async input() {
    const result = await this._makeRequest(
      "GET",
      `/executions/${this.executionId}/input`,
    );
    // `??` (not `||`): falsy-but-present values (0, false, "") are
    // legitimate data and must round-trip; only true absence becomes null.
    return result?.data ?? null;
  }

  /**
   * Set output data for this execution
   * @param {any} data - The output data
   * @returns {Promise<void>}
   */
  async output(data) {
    await this._makeRequest("POST", `/executions/${this.executionId}/output`, {
      data,
    });
  }

  /**
   * Get a variable value
   * @param {string} key - The variable key
   * @returns {Promise<any>} The variable value
   */
  async getVariable(key) {
    try {
      const result = await this._makeRequest(
        "GET",
        `/executions/${this.executionId}/variables/${encodeURIComponent(key)}`,
      );
      // `??` (not `||`): preserve falsy-but-present values (0, false, "").
      return result?.data?.value ?? null;
    } catch (error) {
      if (error instanceof CroniumAPIError && error.statusCode === 404) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Set a variable value
   * @param {string} key - The variable key
   * @param {any} value - The value to set
   * @returns {Promise<void>}
   */
  async setVariable(key, value) {
    await this._makeRequest(
      "PUT",
      `/executions/${this.executionId}/variables/${encodeURIComponent(key)}`,
      { value },
    );
  }

  /**
   * Set the workflow condition
   * @param {boolean} condition - The condition value
   * @returns {Promise<void>}
   */
  async setCondition(condition) {
    await this._makeRequest(
      "POST",
      `/executions/${this.executionId}/condition`,
      { condition },
    );
  }

  /**
   * Get the current event context
   * @returns {Promise<Object>} Event metadata
   */
  async event() {
    const result = await this._makeRequest(
      "GET",
      `/executions/${this.executionId}/context`,
    );
    return result?.data ?? {};
  }

  /**
   * Execute a tool action
   * @param {string} tool - Tool name
   * @param {string} action - Action name
   * @param {Object} config - Tool configuration
   * @returns {Promise<any>} Tool action result
   */
  async executeToolAction(tool, action, config) {
    const result = await this._makeRequest("POST", "/tool-actions/execute", {
      tool,
      action,
      config,
    });
    // `??` (not `||`): preserve falsy-but-present results (0, false, "").
    return result?.data ?? null;
  }

  /**
   * Send an email using the email tool
   * @param {Object} options - Email options
   * @returns {Promise<any>} Email result
   */
  async sendEmail({ to, subject, body, ...extras }) {
    const config = {
      to: Array.isArray(to) ? to : [to],
      subject,
      body,
      ...extras,
    };
    return this.executeToolAction("email", "send_message", config);
  }

  /**
   * Send a Slack message
   * @param {Object} options - Slack options
   * @returns {Promise<any>} Slack result
   */
  async sendSlackMessage({ channel, text, ...extras }) {
    const config = {
      channel,
      text,
      ...extras,
    };
    return this.executeToolAction("slack", "send_message", config);
  }

  /**
   * Send a Discord message
   * @param {Object} options - Discord options
   * @returns {Promise<any>} Discord result
   */
  async sendDiscordMessage({ channelId, content, ...extras }) {
    const config = {
      channelId,
      content,
      ...extras,
    };
    return this.executeToolAction("discord", "send_message", config);
  }
}

// Create singleton instance
const cronium = new Cronium();

// Export main class and instance
module.exports = Cronium;
module.exports.cronium = cronium;

// Export convenience functions
module.exports.input = () => cronium.input();
module.exports.output = (data) => cronium.output(data);
module.exports.getVariable = (key) => cronium.getVariable(key);
module.exports.setVariable = (key, value) => cronium.setVariable(key, value);
module.exports.setCondition = (condition) => cronium.setCondition(condition);
module.exports.event = () => cronium.event();
module.exports.executeToolAction = (tool, action, config) =>
  cronium.executeToolAction(tool, action, config);
module.exports.sendEmail = (options) => cronium.sendEmail(options);
module.exports.sendSlackMessage = (options) =>
  cronium.sendSlackMessage(options);
module.exports.sendDiscordMessage = (options) =>
  cronium.sendDiscordMessage(options);

// Export error classes
module.exports.CroniumError = CroniumError;
module.exports.CroniumAPIError = CroniumAPIError;
module.exports.CroniumTimeoutError = CroniumTimeoutError;
