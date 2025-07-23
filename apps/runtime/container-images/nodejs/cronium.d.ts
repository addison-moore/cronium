/**
 * Type definitions for Cronium Runtime SDK
 */

/**
 * Base error class for Cronium SDK errors
 */
export declare class CroniumError extends Error {
  constructor(message: string);
}

/**
 * API request error
 */
export declare class CroniumAPIError extends CroniumError {
  statusCode: number;
  constructor(statusCode: number, message: string);
}

/**
 * Request timeout error
 */
export declare class CroniumTimeoutError extends CroniumError {
  constructor(message: string);
}

/**
 * Event context metadata
 */
export interface EventContext {
  id: string;
  name: string;
  type: string;
  userId: string;
  executionId: string;
  [key: string]: any;
}

/**
 * Email options
 */
export interface EmailOptions {
  to: string | string[];
  subject: string;
  body: string;
  cc?: string | string[];
  bcc?: string | string[];
  attachments?: any[];
  [key: string]: any;
}

/**
 * Slack message options
 */
export interface SlackOptions {
  channel: string;
  text: string;
  attachments?: any[];
  blocks?: any[];
  [key: string]: any;
}

/**
 * Discord message options
 */
export interface DiscordOptions {
  channelId: string;
  content: string;
  embeds?: any[];
  [key: string]: any;
}

/**
 * Tool action configuration
 */
export interface ToolActionConfig {
  [key: string]: any;
}

/**
 * Main Cronium client class
 */
export declare class Cronium {
  constructor();

  /**
   * Get input data for this execution
   */
  input(): Promise<any>;

  /**
   * Set output data for this execution
   */
  output(data: any): Promise<void>;

  /**
   * Get a variable value
   */
  getVariable(key: string): Promise<any>;

  /**
   * Set a variable value
   */
  setVariable(key: string, value: any): Promise<void>;

  /**
   * Set the workflow condition
   */
  setCondition(condition: boolean): Promise<void>;

  /**
   * Get the current event context
   */
  event(): Promise<EventContext>;

  /**
   * Execute a tool action
   */
  executeToolAction(
    tool: string,
    action: string,
    config: ToolActionConfig,
  ): Promise<any>;

  /**
   * Send an email using the email tool
   */
  sendEmail(options: EmailOptions): Promise<any>;

  /**
   * Send a Slack message
   */
  sendSlackMessage(options: SlackOptions): Promise<any>;

  /**
   * Send a Discord message
   */
  sendDiscordMessage(options: DiscordOptions): Promise<any>;
}

/**
 * Global cronium instance
 */
export declare const cronium: Cronium;

/**
 * Convenience functions
 */
export declare function input(): Promise<any>;
export declare function output(data: any): Promise<void>;
export declare function getVariable(key: string): Promise<any>;
export declare function setVariable(key: string, value: any): Promise<void>;
export declare function setCondition(condition: boolean): Promise<void>;
export declare function event(): Promise<EventContext>;
export declare function executeToolAction(
  tool: string,
  action: string,
  config: ToolActionConfig,
): Promise<any>;
export declare function sendEmail(options: EmailOptions): Promise<any>;
export declare function sendSlackMessage(options: SlackOptions): Promise<any>;
export declare function sendDiscordMessage(
  options: DiscordOptions,
): Promise<any>;

export default Cronium;
