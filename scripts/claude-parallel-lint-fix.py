#!/usr/bin/env python3

import asyncio
import re
import sys
import argparse
from pathlib import Path
from typing import Dict, List, Tuple
from collections import defaultdict
import json

class LintError:
    def __init__(self, line: int, column: int, severity: str, message: str, rule: str):
        self.line = line
        self.column = column
        self.severity = severity
        self.message = message
        self.rule = rule
    
    def __repr__(self):
        return f"{self.severity} at {self.line}:{self.column} - {self.message} ({self.rule})"

class ParallelLintFixer:
    def __init__(self, max_concurrent_agents: int = 5, lint_log_path: str = "lint.log"):
        self.max_concurrent_agents = max_concurrent_agents
        self.lint_log_path = lint_log_path
        self.file_errors: Dict[str, List[LintError]] = defaultdict(list)
        
    def parse_lint_log(self) -> Dict[str, List[LintError]]:
        """Parse the lint log file and group errors by file."""
        file_pattern = re.compile(r'^\.\/(.+)$')
        error_pattern = re.compile(r'^(\d+):(\d+)\s+(Error|Warning):\s+(.+?)\s+(@[\w-]+/[\w-]+)$')
        
        current_file = None
        
        with open(self.lint_log_path, 'r') as f:
            for line in f:
                line = line.strip()
                
                # Check if this is a file path
                file_match = file_pattern.match(line)
                if file_match:
                    current_file = file_match.group(1)
                    continue
                
                # Check if this is an error/warning line
                if current_file:
                    error_match = error_pattern.match(line)
                    if error_match:
                        line_num, column, severity, message, rule = error_match.groups()
                        error = LintError(
                            line=int(line_num),
                            column=int(column),
                            severity=severity,
                            message=message,
                            rule=rule
                        )
                        self.file_errors[current_file].append(error)
        
        return self.file_errors
    
    def create_fix_prompt(self, file_path: str, errors: List[LintError]) -> str:
        """Create a detailed prompt for fixing a specific file."""
        # Group errors by type for better organization
        errors_by_rule = defaultdict(list)
        for error in errors:
            errors_by_rule[error.rule].append(error)
        
        prompt_parts = [
            f"Fix all linting errors in the file: {file_path}",
            "",
            "Errors to fix:"
        ]
        
        # Add specific instructions based on error types
        if '@typescript-eslint/no-unused-vars' in errors_by_rule:
            prompt_parts.append("\nUnused variables/imports:")
            for error in errors_by_rule['@typescript-eslint/no-unused-vars']:
                prompt_parts.append(f"  - Line {error.line}: {error.message}")
            prompt_parts.append("  Fix: Remove the import/variable OR prefix with underscore (_) if it should be kept")
        
        if '@typescript-eslint/unbound-method' in errors_by_rule:
            prompt_parts.append("\nUnbound method errors:")
            for error in errors_by_rule['@typescript-eslint/unbound-method']:
                prompt_parts.append(f"  - Line {error.line}: {error.message}")
            prompt_parts.append("  Fix: Use arrow function syntax OR add 'this: void' annotation")
        
        if '@typescript-eslint/no-unsafe-assignment' in errors_by_rule or \
           '@typescript-eslint/no-unsafe-member-access' in errors_by_rule:
            prompt_parts.append("\nType safety errors:")
            for rule in ['@typescript-eslint/no-unsafe-assignment', '@typescript-eslint/no-unsafe-member-access']:
                if rule in errors_by_rule:
                    for error in errors_by_rule[rule]:
                        prompt_parts.append(f"  - Line {error.line}: {error.message}")
            prompt_parts.append("  Fix: Add proper type annotations instead of 'any'")
        
        # Add any remaining errors
        handled_rules = {
            '@typescript-eslint/no-unused-vars',
            '@typescript-eslint/unbound-method',
            '@typescript-eslint/no-unsafe-assignment',
            '@typescript-eslint/no-unsafe-member-access'
        }
        
        other_errors = []
        for rule, rule_errors in errors_by_rule.items():
            if rule not in handled_rules:
                other_errors.extend(rule_errors)
        
        if other_errors:
            prompt_parts.append("\nOther errors:")
            for error in other_errors:
                prompt_parts.append(f"  - Line {error.line}: {error.severity} - {error.message} ({error.rule})")
        
        prompt_parts.extend([
            "",
            "Instructions:",
            "1. Read the file first to understand the context",
            "2. Fix ALL listed errors",
            "3. Ensure the fixes maintain code functionality",
            "4. Do not add unnecessary comments",
            "5. Follow the existing code style"
        ])
        
        return "\n".join(prompt_parts)
    
    def generate_agent_tasks(self) -> List[Dict]:
        """Generate task configurations for each file."""
        tasks = []
        
        for file_path, errors in self.file_errors.items():
            task = {
                "file_path": file_path,
                "errors": len(errors),
                "prompt": self.create_fix_prompt(file_path, errors),
                "description": f"Fix {len(errors)} linting errors in {file_path}"
            }
            tasks.append(task)
        
        # Sort tasks by number of errors (fix files with fewer errors first)
        tasks.sort(key=lambda x: x["errors"])
        
        return tasks
    
    def create_batch_script(self, tasks: List[Dict], batch_size: int) -> str:
        """Create a script that processes tasks in batches."""
        script_parts = [
            "# Parallel Lint Fix - Batch Processing Script",
            "",
            f"# This script will process {len(tasks)} files in batches of {batch_size}",
            "",
            "# Configuration",
            f"BATCH_SIZE={batch_size}",
            f"TOTAL_FILES={len(tasks)}",
            "",
            "# Task definitions",
            "declare -a TASKS=("
        ]
        
        # Add each task as a JSON string
        for i, task in enumerate(tasks):
            task_json = json.dumps({
                "index": i,
                "file": task["file_path"],
                "errors": task["errors"],
                "prompt": task["prompt"]
            })
            script_parts.append(f'  {json.dumps(task_json)}')
        
        script_parts.extend([
            ")",
            "",
            "# Function to process a single task",
            "process_task() {",
            "  local task_json=$1",
            "  local file=$(echo $task_json | jq -r '.file')",
            "  local prompt=$(echo $task_json | jq -r '.prompt')",
            "  ",
            "  echo \"🔧 Processing: $file\"",
            "  # Here you would invoke Claude Code with the Task tool",
            "  # For now, this is a placeholder",
            "  echo \"Task: Fix linting errors in $file\"",
            "  echo \"$prompt\"",
            "}",
            "",
            "# Process tasks in batches",
            "for ((i=0; i<${#TASKS[@]}; i+=BATCH_SIZE)); do",
            "  echo \"\\n📦 Starting batch $((i/BATCH_SIZE + 1))...\"",
            "  ",
            "  # Process batch in parallel",
            "  for ((j=i; j<i+BATCH_SIZE && j<${#TASKS[@]}; j++)); do",
            "    process_task \"${TASKS[$j]}\" &",
            "  done",
            "  ",
            "  # Wait for batch to complete",
            "  wait",
            "  echo \"✅ Batch $((i/BATCH_SIZE + 1)) completed\"",
            "done",
            "",
            "echo \"\\n🎉 All tasks completed!\""
        ])
        
        return "\n".join(script_parts)

def main():
    parser = argparse.ArgumentParser(description="Fix linting errors in parallel using Claude Code")
    parser.add_argument("--max-agents", type=int, default=5, help="Maximum concurrent agents")
    parser.add_argument("--lint-log", default="lint.log", help="Path to lint log file")
    parser.add_argument("--output", help="Output file for task list (JSON format)")
    parser.add_argument("--batch-script", help="Generate a bash script for batch processing")
    
    args = parser.parse_args()
    
    fixer = ParallelLintFixer(
        max_concurrent_agents=args.max_agents,
        lint_log_path=args.lint_log
    )
    
    print(f"🔍 Parsing lint log: {args.lint_log}")
    fixer.parse_lint_log()
    
    print(f"📊 Found {len(fixer.file_errors)} files with errors")
    
    # Show summary
    total_errors = sum(len(errors) for errors in fixer.file_errors.values())
    print(f"📈 Total errors: {total_errors}")
    
    # Generate tasks
    tasks = fixer.generate_agent_tasks()
    
    # Output tasks if requested
    if args.output:
        with open(args.output, 'w') as f:
            json.dump(tasks, f, indent=2)
        print(f"📝 Task list saved to: {args.output}")
    
    # Generate batch script if requested
    if args.batch_script:
        script = fixer.create_batch_script(tasks, args.max_agents)
        with open(args.batch_script, 'w') as f:
            f.write(script)
        Path(args.batch_script).chmod(0o755)
        print(f"📜 Batch script saved to: {args.batch_script}")
    
    # Print example usage
    print("\n🚀 Example usage with Claude Code:")
    print(f"1. For individual files: Use Task tool with the prompts generated")
    print(f"2. For batch processing: Run the generated script")
    print(f"3. Configure max concurrent agents: --max-agents {args.max_agents}")
    
    # Show first few tasks as examples
    print("\n📋 First 3 tasks:")
    for i, task in enumerate(tasks[:3]):
        print(f"\n{i+1}. {task['description']}")
        print(f"   File: {task['file_path']}")
        print(f"   Errors: {task['errors']}")

if __name__ == "__main__":
    main()