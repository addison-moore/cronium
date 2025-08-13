package helpers

import (
	"fmt"
	"os"
	"path/filepath"
)

// DiscoveryScript generates a shell script that creates wrapper functions for the helpers
func GenerateDiscoveryScript(helperDir string) string {
	// Generate shell functions that call the helper binaries
	script := `#!/bin/bash
# Cronium Runtime Helper Functions

# Helper binary directory
export CRONIUM_HELPERS_DIR="%s"

# cronium.input() - Get input data
cronium.input() {
    "${CRONIUM_HELPERS_DIR}/cronium.input" "$@"
}

# cronium.output() - Set output data
cronium.output() {
    "${CRONIUM_HELPERS_DIR}/cronium.output" "$@"
}

# cronium.getVariable() - Get a variable value
cronium.getVariable() {
    "${CRONIUM_HELPERS_DIR}/cronium.getVariable" "$@"
}

# cronium.setVariable() - Set a variable value
cronium.setVariable() {
    "${CRONIUM_HELPERS_DIR}/cronium.setVariable" "$@"
}

# cronium.event() - Get event context
cronium.event() {
    "${CRONIUM_HELPERS_DIR}/cronium.event" "$@"
}

# Export functions for use in subshells
export -f cronium.input
export -f cronium.output
export -f cronium.getVariable
export -f cronium.setVariable
export -f cronium.event
`
	return fmt.Sprintf(script, helperDir)
}

// GeneratePythonDiscovery generates Python code for helper discovery
func GeneratePythonDiscovery(helperDir string) string {
	return fmt.Sprintf(`#!/usr/bin/env python3
import os
import sys
import json
import subprocess

# Helper binary directory
CRONIUM_HELPERS_DIR = "%s"


class cronium:
    """Cronium runtime helper functions"""
    
    @staticmethod
    def input():
        """Get input data"""
        result = subprocess.run(
            [os.path.join(CRONIUM_HELPERS_DIR, "cronium.input")],
            capture_output=True,
            text=True,
            env=os.environ.copy()
        )
        if result.returncode != 0:
            raise RuntimeError(f"cronium.input failed: {result.stderr}")
        return json.loads(result.stdout) if result.stdout.strip() else None
    
    @staticmethod
    def output(data):
        """Set output data"""
        json_data = json.dumps(data)
        result = subprocess.run(
            [os.path.join(CRONIUM_HELPERS_DIR, "cronium.output")],
            input=json_data,
            capture_output=True,
            text=True,
            env=os.environ.copy()
        )
        if result.returncode != 0:
            raise RuntimeError(f"cronium.output failed: {result.stderr}")
    
    @staticmethod
    def getVariable(key):
        """Get a variable value"""
        result = subprocess.run(
            [os.path.join(CRONIUM_HELPERS_DIR, "cronium.getVariable"), key],
            capture_output=True,
            text=True,
            env=os.environ.copy()
        )
        if result.returncode != 0:
            raise RuntimeError(f"cronium.getVariable failed: {result.stderr}")
        return json.loads(result.stdout) if result.stdout.strip() else None
    
    @staticmethod
    def setVariable(key, value):
        """Set a variable value"""
        json_value = json.dumps(value)
        result = subprocess.run(
            [os.path.join(CRONIUM_HELPERS_DIR, "cronium.setVariable"), key],
            input=json_value,
            capture_output=True,
            text=True,
            env=os.environ.copy()
        )
        if result.returncode != 0:
            raise RuntimeError(f"cronium.setVariable failed: {result.stderr}")
    
    @staticmethod
    def event():
        """Get event context"""
        result = subprocess.run(
            [os.path.join(CRONIUM_HELPERS_DIR, "cronium.event")],
            capture_output=True,
            text=True,
            env=os.environ.copy()
        )
        if result.returncode != 0:
            raise RuntimeError(f"cronium.event failed: {result.stderr}")
        return json.loads(result.stdout) if result.stdout.strip() else {}

# Add to builtins so it's available without import
import builtins
builtins.cronium = cronium
`, helperDir)
}

// GenerateNodeDiscovery generates Node.js code for helper discovery
func GenerateNodeDiscovery(helperDir string) string {
	return fmt.Sprintf(`const { execSync } = require('child_process');
const path = require('path');

// Helper binary directory
const CRONIUM_HELPERS_DIR = '%s';

// Create global cronium object
global.cronium = {
    input: function() {
        try {
            const result = execSync(path.join(CRONIUM_HELPERS_DIR, 'cronium.input'), { encoding: 'utf8' });
            return result.trim() ? JSON.parse(result) : null;
        } catch (error) {
            throw new Error('cronium.input failed: ' + error.message);
        }
    },
    
    output: function(data) {
        try {
            const jsonData = JSON.stringify(data);
            execSync(path.join(CRONIUM_HELPERS_DIR, 'cronium.output'), {
                input: jsonData,
                encoding: 'utf8'
            });
        } catch (error) {
            throw new Error('cronium.output failed: ' + error.message);
        }
    },
    
    getVariable: function(key) {
        try {
            const result = execSync(path.join(CRONIUM_HELPERS_DIR, 'cronium.getVariable') + ' ' + key, { encoding: 'utf8' });
            return result.trim() ? JSON.parse(result) : null;
        } catch (error) {
            throw new Error('cronium.getVariable failed: ' + error.message);
        }
    },
    
    setVariable: function(key, value) {
        try {
            const jsonValue = JSON.stringify(value);
            execSync(path.join(CRONIUM_HELPERS_DIR, 'cronium.setVariable') + ' ' + key, {
                input: jsonValue,
                encoding: 'utf8'
            });
        } catch (error) {
            throw new Error('cronium.setVariable failed: ' + error.message);
        }
    },
    
    event: function() {
        try {
            const result = execSync(path.join(CRONIUM_HELPERS_DIR, 'cronium.event'), { encoding: 'utf8' });
            return result.trim() ? JSON.parse(result) : {};
        } catch (error) {
            throw new Error('cronium.event failed: ' + error.message);
        }
    }
};
`, helperDir)
}

// SetupDiscovery creates discovery scripts for the given interpreter
func SetupDiscovery(workDir string, interpreter string) error {
	helpersDir := filepath.Join(workDir, ".cronium", "bin")
	
	switch interpreter {
	case "bash":
		// Source the discovery script in bash
		scriptPath := filepath.Join(workDir, ".cronium", "discovery.sh")
		script := GenerateDiscoveryScript(helpersDir)
		if err := os.WriteFile(scriptPath, []byte(script), 0755); err != nil {
			return fmt.Errorf("failed to write bash discovery script: %w", err)
		}
		
	case "python":
		// Create Python discovery module
		scriptPath := filepath.Join(workDir, ".cronium", "discovery.py")
		script := GeneratePythonDiscovery(helpersDir)
		if err := os.WriteFile(scriptPath, []byte(script), 0755); err != nil {
			return fmt.Errorf("failed to write Python discovery script: %w", err)
		}
		
	case "node":
		// Create Node.js discovery module
		scriptPath := filepath.Join(workDir, ".cronium", "discovery.js")
		script := GenerateNodeDiscovery(helpersDir)
		if err := os.WriteFile(scriptPath, []byte(script), 0644); err != nil {
			return fmt.Errorf("failed to write Node.js discovery script: %w", err)
		}
	}
	
	return nil
}