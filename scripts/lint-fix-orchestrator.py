#!/usr/bin/env python3
"""
Lint Fix Orchestrator - Coordinates parallel fixing of linting errors using Claude Code.

This script demonstrates how to:
1. Parse linting errors from a log file
2. Group errors by file
3. Create focused fix tasks for subagents
4. Manage concurrent execution with configurable limits
"""

import re
import json
import argparse
from typing import Dict, List
from collections import defaultdict
from datetime import datetime

class LintFixOrchestrator:
    def __init__(self, max_concurrent: int = 5):
        self.max_concurrent = max_concurrent
        self.file_errors = defaultdict(list)
        self.processed_files = set()
        
    def parse_lint_log(self, log_path: str) -> Dict[str, List[dict]]:
        """Parse ESLint output and group by file."""
        current_file = None
        file_pattern = re.compile(r'^\.\/(.+)$')
        error_pattern = re.compile(
            r'^(\d+):(\d+)\s+(Error|Warning):\s+(.+?)\s+(@[\w-]+/[\w-]+)$'
        )
        
        with open(log_path, 'r') as f:
            for line in f:
                line = line.strip()
                
                # New file section
                file_match = file_pattern.match(line)
                if file_match:
                    current_file = file_match.group(1)
                    continue
                
                # Error/warning line
                if current_file and error_pattern.match(line):
                    match = error_pattern.match(line)
                    self.file_errors[current_file].append({
                        'line': int(match.group(1)),
                        'column': int(match.group(2)),
                        'severity': match.group(3),
                        'message': match.group(4),
                        'rule': match.group(5)
                    })
        
        return dict(self.file_errors)
    
    def prioritize_files(self, file_errors: Dict[str, List[dict]]) -> List[tuple]:
        """Prioritize files for fixing based on error count and type."""
        priorities = []
        
        for file_path, errors in file_errors.items():
            # Count error types
            error_count = sum(1 for e in errors if e['severity'] == 'Error')
            warning_count = sum(1 for e in errors if e['severity'] == 'Warning')
            
            # Simple priority: fewer total issues first (easier wins)
            # Could be enhanced with more sophisticated logic
            priority_score = len(errors)
            
            priorities.append((priority_score, file_path, error_count, warning_count))
        
        # Sort by priority (ascending - fix easier files first)
        priorities.sort(key=lambda x: x[0])
        
        return priorities
    
    def create_fix_instructions(self, file_path: str, errors: List[dict]) -> str:
        """Create detailed fix instructions for a specific file."""
        # Group errors by rule for clearer instructions
        errors_by_rule = defaultdict(list)
        for error in errors:
            errors_by_rule[error['rule']].append(error)
        
        instructions = [
            f"Fix all {len(errors)} linting issues in: {file_path}",
            "",
            "ERRORS TO FIX:",
            ""
        ]
        
        # Add specific fix instructions based on common error patterns
        fix_guides = {
            '@typescript-eslint/no-unused-vars': 
                "Remove the unused import/variable OR prefix with underscore (_) if needed for later",
            '@typescript-eslint/unbound-method': 
                "Convert to arrow function OR add 'this: void' parameter annotation",
            '@typescript-eslint/no-unsafe-assignment': 
                "Add proper type annotations to replace 'any' types",
            '@typescript-eslint/no-unsafe-member-access': 
                "Add type guards or proper type annotations for safe access",
            '@typescript-eslint/no-explicit-any': 
                "Replace 'any' with specific type (unknown, proper interface, etc.)",
            '@typescript-eslint/restrict-template-expressions':
                "Ensure only string/number types in template literals (use String() if needed)"
        }
        
        for rule, rule_errors in errors_by_rule.items():
            instructions.append(f"{rule}: ({len(rule_errors)} occurrences)")
            
            # Add specific fix guide if available
            if rule in fix_guides:
                instructions.append(f"  Fix: {fix_guides[rule]}")
            
            # List specific instances
            for error in rule_errors[:5]:  # Show first 5 instances
                instructions.append(f"  - Line {error['line']}: {error['message']}")
            
            if len(rule_errors) > 5:
                instructions.append(f"  ... and {len(rule_errors) - 5} more")
            
            instructions.append("")
        
        instructions.extend([
            "IMPORTANT:",
            "1. Read the file first to understand context",
            "2. Fix ALL listed errors systematically", 
            "3. Maintain existing code functionality",
            "4. Follow the project's coding style",
            "5. Don't add unnecessary comments"
        ])
        
        return "\n".join(instructions)
    
    def generate_task_batches(self, file_errors: Dict[str, List[dict]]) -> List[List[dict]]:
        """Generate batches of tasks respecting concurrency limits."""
        prioritized = self.prioritize_files(file_errors)
        batches = []
        current_batch = []
        
        for _, file_path, error_count, warning_count in prioritized:
            task = {
                'file': file_path,
                'error_count': error_count,
                'warning_count': warning_count,
                'total_issues': error_count + warning_count,
                'instructions': self.create_fix_instructions(file_path, file_errors[file_path])
            }
            
            current_batch.append(task)
            
            if len(current_batch) >= self.max_concurrent:
                batches.append(current_batch)
                current_batch = []
        
        if current_batch:
            batches.append(current_batch)
        
        return batches
    
    def create_execution_plan(self, batches: List[List[dict]]) -> dict:
        """Create a detailed execution plan."""
        total_files = sum(len(batch) for batch in batches)
        total_errors = sum(task['error_count'] for batch in batches for task in batch)
        total_warnings = sum(task['warning_count'] for batch in batches for task in batch)
        
        plan = {
            'created_at': datetime.now().isoformat(),
            'configuration': {
                'max_concurrent_agents': self.max_concurrent,
                'total_files': total_files,
                'total_errors': total_errors,
                'total_warnings': total_warnings,
                'total_batches': len(batches)
            },
            'batches': []
        }
        
        for i, batch in enumerate(batches):
            batch_info = {
                'batch_number': i + 1,
                'files_count': len(batch),
                'total_issues': sum(task['total_issues'] for task in batch),
                'tasks': batch
            }
            plan['batches'].append(batch_info)
        
        return plan
    
    def generate_example_commands(self, plan: dict) -> List[str]:
        """Generate example commands for executing the plan."""
        commands = [
            "# Example commands for fixing linting errors:",
            "",
            "# Option 1: Process first batch manually",
        ]
        
        if plan['batches']:
            first_batch = plan['batches'][0]
            for task in first_batch['tasks'][:2]:  # Show first 2 tasks
                commands.append(f"# Fix {task['file']} ({task['total_issues']} issues)")
        
        commands.extend([
            "",
            "# Option 2: Use the generated execution plan",
            f"# Total batches: {len(plan['batches'])}",
            f"# Files per batch: {self.max_concurrent}",
            "",
            "# You can now use Claude Code's Task tool to process each file",
            "# with the generated instructions for systematic fixing."
        ])
        
        return commands

def main():
    parser = argparse.ArgumentParser(
        description="Orchestrate parallel fixing of linting errors"
    )
    parser.add_argument(
        "--lint-log", 
        default="lint.log",
        help="Path to ESLint output log"
    )
    parser.add_argument(
        "--max-concurrent",
        type=int,
        default=5,
        help="Maximum concurrent subagents"
    )
    parser.add_argument(
        "--output",
        help="Save execution plan to JSON file"
    )
    parser.add_argument(
        "--summary",
        action="store_true",
        help="Show summary only"
    )
    
    args = parser.parse_args()
    
    orchestrator = LintFixOrchestrator(max_concurrent=args.max_concurrent)
    
    print(f"🔍 Analyzing lint log: {args.lint_log}")
    file_errors = orchestrator.parse_lint_log(args.lint_log)
    
    if not file_errors:
        print("✨ No linting errors found!")
        return
    
    print(f"📊 Found {len(file_errors)} files with linting issues")
    
    # Generate batches
    batches = orchestrator.generate_task_batches(file_errors)
    plan = orchestrator.create_execution_plan(batches)
    
    # Show summary
    config = plan['configuration']
    print(f"\n📈 Summary:")
    print(f"  Total files: {config['total_files']}")
    print(f"  Total errors: {config['total_errors']}")
    print(f"  Total warnings: {config['total_warnings']}")
    print(f"  Batches: {config['total_batches']} (max {args.max_concurrent} concurrent)")
    
    if not args.summary:
        # Show batch details
        print(f"\n📦 Batch Plan:")
        for batch_info in plan['batches'][:3]:  # Show first 3 batches
            print(f"\n  Batch {batch_info['batch_number']}:")
            print(f"    Files: {batch_info['files_count']}")
            print(f"    Total issues: {batch_info['total_issues']}")
            
            for task in batch_info['tasks'][:2]:  # Show first 2 tasks
                print(f"    - {task['file']} ({task['total_issues']} issues)")
        
        if len(plan['batches']) > 3:
            print(f"\n  ... and {len(plan['batches']) - 3} more batches")
    
    # Save plan if requested
    if args.output:
        with open(args.output, 'w') as f:
            json.dump(plan, f, indent=2)
        print(f"\n💾 Execution plan saved to: {args.output}")
    
    # Show example usage
    print("\n🚀 Next steps:")
    example_commands = orchestrator.generate_example_commands(plan)
    for cmd in example_commands:
        print(cmd)

if __name__ == "__main__":
    main()