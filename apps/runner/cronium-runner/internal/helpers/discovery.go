package helpers

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// The generated scripts below give a script on a remote server the same SDK it has
// in a container (apps/runtime/runtime-helpers), through the helper binaries. They
// use a placeholder rather than fmt, because they are full of % and {}.
const helpersDirPlaceholder = "__CRONIUM_HELPERS_DIR__"

const bashDiscoveryTemplate = `#!/bin/bash
# Cronium Runtime Helper Functions

# Helper binary directory
export CRONIUM_HELPERS_DIR="__CRONIUM_HELPERS_DIR__"

# The SDK the container documents (apps/runtime/runtime-helpers/bash/README.md).
# Values reach the binaries on stdin where they can be large, because a single
# argument is capped at 128 KB and would show up in ps.

cronium_input() {
    "${CRONIUM_HELPERS_DIR}/cronium.input" --raw
}

cronium_output() {
    if [ "$#" -gt 0 ]; then
        printf '%s' "$1" | "${CRONIUM_HELPERS_DIR}/cronium.output"
    else
        "${CRONIUM_HELPERS_DIR}/cronium.output"
    fi
}

cronium_get_variable() {
    "${CRONIUM_HELPERS_DIR}/cronium.getVariable" --raw "$1"
}

cronium_set_variable() {
    printf '%s' "$2" | "${CRONIUM_HELPERS_DIR}/cronium.setVariable" "$1"
}

cronium_set_condition() {
    "${CRONIUM_HELPERS_DIR}/cronium.setCondition" "$1"
}

cronium_event() {
    "${CRONIUM_HELPERS_DIR}/cronium.event"
}

cronium_event_field() {
    "${CRONIUM_HELPERS_DIR}/cronium.event" --field "$1"
}

cronium_execute_tool_action() {
    printf '%s' "$3" | "${CRONIUM_HELPERS_DIR}/cronium.toolAction" execute "$1" "$2"
}

cronium_send_email() {
    "${CRONIUM_HELPERS_DIR}/cronium.toolAction" email "$@"
}

cronium_send_slack_message() {
    "${CRONIUM_HELPERS_DIR}/cronium.toolAction" slack "$@"
}

cronium_send_discord_message() {
    "${CRONIUM_HELPERS_DIR}/cronium.toolAction" discord "$@"
}

cronium_variable_exists() {
    local value
    value=$(cronium_get_variable "$1" 2>/dev/null)
    [ -n "$value" ]
}

cronium_delete_variable() {
    cronium_set_variable "$1" "null"
}

cronium_increment_variable() {
    local key="$1"
    local increment="${2:-1}"
    local current
    current=$(cronium_get_variable "$key" 2>/dev/null || echo "0")
    current="${current:-0}"

    if ! [[ "$current" =~ ^-?[0-9]+$ ]]; then
        echo "Error: Variable '$key' is not numeric" >&2
        return 1
    fi

    local new_value=$((current + increment))
    cronium_set_variable "$key" "$new_value"
    echo "$new_value"
}

cronium_append_variable() {
    local key="$1"
    local append="$2"
    local separator="${3:-}"
    local current
    current=$(cronium_get_variable "$key" 2>/dev/null || echo "")

    if [ -z "$current" ]; then
        cronium_set_variable "$key" "$append"
    else
        cronium_set_variable "$key" "${current}${separator}${append}"
    fi
}

cronium_info() {
    echo "Cronium Bash SDK v2.0.0"
    echo "API URL: ${CRONIUM_API_ENDPOINT:-}"
    echo "Execution ID: ${CRONIUM_EXECUTION_ID:-}"
    echo "Token: ${CRONIUM_API_TOKEN:0:10}..."
}

# The runner's older dotted names. They exist only on a remote server and keep
# printing JSON, so scripts already parsing that output keep working.

cronium.input() {
    "${CRONIUM_HELPERS_DIR}/cronium.input" "$@"
}

cronium.output() {
    cronium_output "$@"
}

cronium.getVariable() {
    "${CRONIUM_HELPERS_DIR}/cronium.getVariable" "$@"
}

cronium.setVariable() {
    "${CRONIUM_HELPERS_DIR}/cronium.setVariable" "$@"
}

cronium.setCondition() {
    "${CRONIUM_HELPERS_DIR}/cronium.setCondition" "$@"
}

cronium.event() {
    "${CRONIUM_HELPERS_DIR}/cronium.event" "$@"
}

# Export functions for use in subshells
export -f cronium_input cronium_output
export -f cronium_get_variable cronium_set_variable cronium_set_condition
export -f cronium_event cronium_event_field
export -f cronium_execute_tool_action cronium_send_email
export -f cronium_send_slack_message cronium_send_discord_message
export -f cronium_variable_exists cronium_delete_variable
export -f cronium_increment_variable cronium_append_variable cronium_info
export -f cronium.input cronium.output cronium.getVariable cronium.setVariable
export -f cronium.setCondition cronium.event
`

const pythonDiscoveryTemplate = `#!/usr/bin/env python3
import asyncio
import functools
import json
import os
import re
import subprocess
import sys

# Helper binary directory
CRONIUM_HELPERS_DIR = "__CRONIUM_HELPERS_DIR__"


class CroniumError(RuntimeError):
    """Base exception for Cronium SDK errors"""


class CroniumAPIError(CroniumError):
    """API request failed"""

    def __init__(self, status_code, message):
        self.status_code = status_code
        self.message = message
        super().__init__(f"API Error ({status_code}): {message}")


class CroniumTimeoutError(CroniumError):
    """Request timed out"""


def _run_helper(name, args=(), stdin=""):
    result = subprocess.run(
        [os.path.join(CRONIUM_HELPERS_DIR, name), *args],
        input=stdin,
        capture_output=True,
        encoding="utf-8",
        env=os.environ.copy(),
    )
    if result.returncode != 0:
        detail = result.stderr.strip()
        match = re.search(r"HTTP (\d{3})", detail)
        if match:
            raise CroniumAPIError(int(match.group(1)), detail)
        raise CroniumError(f"{name} failed: {detail}")
    return result.stdout


def _parse(text):
    return json.loads(text) if text.strip() else None


class cronium:
    """Cronium runtime helper functions"""

    @staticmethod
    def input():
        """Get input data"""
        return _parse(_run_helper("cronium.input"))

    @staticmethod
    def output(data):
        """Set output data"""
        _run_helper("cronium.output", stdin=json.dumps(data))

    @staticmethod
    def getVariable(key):
        """Get a variable value"""
        return _parse(_run_helper("cronium.getVariable", [key]))

    @staticmethod
    def setVariable(key, value):
        """Set a variable value"""
        _run_helper("cronium.setVariable", [key], json.dumps(value))

    @staticmethod
    def setCondition(condition):
        """Set the workflow condition"""
        if not isinstance(condition, bool):
            raise CroniumError(f"condition must be a bool, got {type(condition).__name__}")
        _run_helper("cronium.setCondition", ["true" if condition else "false"])

    @staticmethod
    def event():
        """Get event context"""
        return _parse(_run_helper("cronium.event")) or {}

    @staticmethod
    def execute_tool_action(tool, action, config):
        """Execute a tool action"""
        return _parse(_run_helper("cronium.toolAction", ["execute", tool, action], json.dumps(config)))

    @staticmethod
    def send_email(to, subject, body, **kwargs):
        """Send an email using the email tool"""
        config = {"to": to if isinstance(to, list) else [to], "subject": subject, "body": body, **kwargs}
        return cronium.execute_tool_action("email", "send_message", config)

    @staticmethod
    def send_slack_message(channel, text, **kwargs):
        """Send a Slack message"""
        return cronium.execute_tool_action("slack", "send_message", {"channel": channel, "text": text, **kwargs})

    @staticmethod
    def send_discord_message(channel_id, content, **kwargs):
        """Send a Discord message"""
        return cronium.execute_tool_action("discord", "send_message", {"channelId": channel_id, "content": content, **kwargs})


class AsyncCronium:
    """The same helpers, awaitable."""

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return None

    async def close(self):
        return None

    def __getattr__(self, name):
        method = getattr(cronium, name)

        async def call(*args, **kwargs):
            loop = asyncio.get_running_loop()
            return await loop.run_in_executor(None, functools.partial(method, *args, **kwargs))

        return call


# Canonical container-SDK snake_case aliases. The documented Python SDK exposes
# get_variable/set_variable/set_condition, so a script written to the docs runs
# unchanged whether it executes locally (container) or remotely (runner).
cronium.get_variable = cronium.getVariable
cronium.set_variable = cronium.setVariable
cronium.set_condition = cronium.setCondition

# What "import cronium" gives a script in a container.
cronium.Cronium = cronium
cronium.cronium = cronium
cronium.AsyncCronium = AsyncCronium
cronium.CroniumError = CroniumError
cronium.CroniumAPIError = CroniumAPIError
cronium.CroniumTimeoutError = CroniumTimeoutError
sys.modules["cronium"] = cronium

# Add to builtins so it's available without import
import builtins
builtins.cronium = cronium
`

const nodeDiscoveryTemplate = `const { execFileSync } = require('child_process');
const path = require('path');

// Helper binary directory
const CRONIUM_HELPERS_DIR = '__CRONIUM_HELPERS_DIR__';

class CroniumError extends Error {
    constructor(message) {
        super(message);
        this.name = 'CroniumError';
    }
}

class CroniumAPIError extends CroniumError {
    constructor(statusCode, message) {
        super('API Error (' + statusCode + '): ' + message);
        this.name = 'CroniumAPIError';
        this.statusCode = statusCode;
    }
}

class CroniumTimeoutError extends CroniumError {
    constructor(message) {
        super(message);
        this.name = 'CroniumTimeoutError';
    }
}

function runHelper(name, args, stdin) {
    try {
        return execFileSync(path.join(CRONIUM_HELPERS_DIR, name), args || [], {
            encoding: 'utf8',
            input: stdin === undefined ? '' : stdin,
            stdio: ['pipe', 'pipe', 'pipe'],
            maxBuffer: 64 * 1024 * 1024,
        });
    } catch (error) {
        const detail = String(error.stderr || error.message).trim();
        const match = detail.match(/HTTP (\d{3})/);
        if (match) {
            throw new CroniumAPIError(Number(match[1]), detail);
        }
        throw new CroniumError(name + ' failed: ' + detail);
    }
}

function parse(text) {
    return text.trim() ? JSON.parse(text) : null;
}

// JSON.stringify(undefined) is undefined, but the container sends it as null.
function encode(value) {
    return JSON.stringify(value === undefined ? null : value);
}

// Every method returns a Promise, as in the container, though each helper has
// finished by the time its method returns.
class Cronium {
    async input() {
        return parse(runHelper('cronium.input'));
    }

    async output(data) {
        runHelper('cronium.output', [], encode(data));
    }

    async getVariable(key) {
        return parse(runHelper('cronium.getVariable', [key]));
    }

    async setVariable(key, value) {
        runHelper('cronium.setVariable', [key], encode(value));
    }

    async setCondition(condition) {
        if (typeof condition !== 'boolean') {
            throw new CroniumError('condition must be a boolean, got ' + typeof condition);
        }
        runHelper('cronium.setCondition', [String(condition)]);
    }

    async event() {
        return parse(runHelper('cronium.event')) || {};
    }

    async executeToolAction(tool, action, config) {
        return parse(runHelper('cronium.toolAction', ['execute', tool, action], encode(config)));
    }

    async sendEmail({ to, subject, body, ...extras }) {
        const config = { to: Array.isArray(to) ? to : [to], subject, body, ...extras };
        return this.executeToolAction('email', 'send_message', config);
    }

    async sendSlackMessage({ channel, text, ...extras }) {
        return this.executeToolAction('slack', 'send_message', { channel, text, ...extras });
    }

    async sendDiscordMessage({ channelId, content, ...extras }) {
        return this.executeToolAction('discord', 'send_message', { channelId, content, ...extras });
    }
}

const cronium = new Cronium();

// The same shape require('cronium') has in a container.
module.exports = Cronium;
module.exports.cronium = cronium;
module.exports.input = () => cronium.input();
module.exports.output = (data) => cronium.output(data);
module.exports.getVariable = (key) => cronium.getVariable(key);
module.exports.setVariable = (key, value) => cronium.setVariable(key, value);
module.exports.setCondition = (condition) => cronium.setCondition(condition);
module.exports.event = () => cronium.event();
module.exports.executeToolAction = (tool, action, config) => cronium.executeToolAction(tool, action, config);
module.exports.sendEmail = (options) => cronium.sendEmail(options);
module.exports.sendSlackMessage = (options) => cronium.sendSlackMessage(options);
module.exports.sendDiscordMessage = (options) => cronium.sendDiscordMessage(options);
module.exports.CroniumError = CroniumError;
module.exports.CroniumAPIError = CroniumAPIError;
module.exports.CroniumTimeoutError = CroniumTimeoutError;

global.cronium = module.exports;
`

// nodeModuleShim lets require('cronium') find the SDK through NODE_PATH, which is
// how a container exposes it.
const nodeModuleShim = "module.exports = require('./discovery.js');\n"

func renderDiscovery(template, helperDir string) string {
	return strings.ReplaceAll(template, helpersDirPlaceholder, helperDir)
}

// GenerateDiscoveryScript generates a shell script that creates wrapper functions for the helpers
func GenerateDiscoveryScript(helperDir string) string {
	return renderDiscovery(bashDiscoveryTemplate, helperDir)
}

// GeneratePythonDiscovery generates Python code for helper discovery
func GeneratePythonDiscovery(helperDir string) string {
	return renderDiscovery(pythonDiscoveryTemplate, helperDir)
}

// GenerateNodeDiscovery generates Node.js code for helper discovery
func GenerateNodeDiscovery(helperDir string) string {
	return renderDiscovery(nodeDiscoveryTemplate, helperDir)
}

// SetupDiscovery creates discovery scripts for the given interpreter
func SetupDiscovery(workDir string, interpreter string) error {
	helpersDir := filepath.Join(workDir, ".cronium", "bin")

	switch interpreter {
	case "BASH", "bash":
		// Source the discovery script in bash
		scriptPath := filepath.Join(workDir, ".cronium", "discovery.sh")
		script := GenerateDiscoveryScript(helpersDir)
		if err := os.WriteFile(scriptPath, []byte(script), 0755); err != nil {
			return fmt.Errorf("failed to write bash discovery script: %w", err)
		}

	case "PYTHON", "python":
		// Create Python discovery module
		scriptPath := filepath.Join(workDir, ".cronium", "discovery.py")
		script := GeneratePythonDiscovery(helpersDir)
		if err := os.WriteFile(scriptPath, []byte(script), 0755); err != nil {
			return fmt.Errorf("failed to write Python discovery script: %w", err)
		}

	case "NODE", "node":
		// Create Node.js discovery module
		scriptPath := filepath.Join(workDir, ".cronium", "discovery.js")
		script := GenerateNodeDiscovery(helpersDir)
		if err := os.WriteFile(scriptPath, []byte(script), 0644); err != nil {
			return fmt.Errorf("failed to write Node.js discovery script: %w", err)
		}
		shimPath := filepath.Join(workDir, ".cronium", "cronium.js")
		if err := os.WriteFile(shimPath, []byte(nodeModuleShim), 0644); err != nil {
			return fmt.Errorf("failed to write Node.js module shim: %w", err)
		}
	}

	return nil
}
