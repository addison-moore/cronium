#!/usr/bin/env python3
"""
Claude Code Continuous Processor - Direct integration with Task tool for automated processing.

This script creates a queue-based system where completed subagents automatically trigger
the next file to be processed, creating a continuous workflow until all files are done.
"""

import json
import os
import time
import re
from datetime import datetime
from typing import Dict, List
from collections import defaultdict

class ClaudeContinuousProcessor:
    def __init__(self, max_concurrent: int = 5):
        self.max_concurrent = max_concurrent
        self.queue_file = ".claude/processing-queue.json"
        self.status_file = ".claude/processing-status.json"
        
    def parse_lint_log(self, log_path: str) -> Dict[str, List[dict]]:
        """Parse ESLint output and group by file."""
        file_errors = defaultdict(list)
        current_file = None
        file_pattern = re.compile(r'^\.\/(.+)$')
        error_pattern = re.compile(
            r'^(\d+):(\d+)\s+(Error|Warning):\s+(.+?)\s+(@[\w-]+/[\w-]+)$'
        )
        
        with open(log_path, 'r') as f:
            for line in f:
                line = line.strip()
                
                file_match = file_pattern.match(line)
                if file_match:
                    current_file = file_match.group(1)
                    continue
                
                if current_file and error_pattern.match(line):
                    match = error_pattern.match(line)
                    file_errors[current_file].append({
                        'line': int(match.group(1)),
                        'column': int(match.group(2)),
                        'severity': match.group(3),
                        'message': match.group(4),
                        'rule': match.group(5)
                    })
        
        return dict(file_errors)
    
    def create_processing_instructions(self, file_path: str, errors: List[dict]) -> str:
        """Create comprehensive processing instructions that include next-file logic."""
        errors_by_rule = defaultdict(list)
        for error in errors:
            errors_by_rule[error['rule']].append(error)
        
        instructions = [
            f"CONTINUOUS LINT FIX - File: {file_path}",
            f"===============================================",
            f"",
            f"Fix all {len(errors)} linting issues in: {file_path}",
            f"",
            f"ERRORS TO FIX:",
            f""
        ]
        
        # Error-specific fix instructions
        fix_guides = {
            '@typescript-eslint/no-unused-vars': 
                "Remove unused import/variable OR prefix with underscore (_)",
            '@typescript-eslint/unbound-method': 
                "Convert to arrow function OR add 'this: void' annotation",
            '@typescript-eslint/no-unsafe-assignment': 
                "Add proper type annotations to replace 'any' types",
            '@typescript-eslint/no-unsafe-member-access': 
                "Add type guards or proper type annotations",
            '@typescript-eslint/no-explicit-any': 
                "Replace 'any' with specific type",
            '@typescript-eslint/restrict-template-expressions':
                "Ensure only string/number types in template literals",
            '@typescript-eslint/no-base-to-string':
                "Use proper type checking or JSON.stringify() for objects"
        }
        
        for rule, rule_errors in errors_by_rule.items():
            instructions.append(f"{rule}: ({len(rule_errors)} occurrences)")
            if rule in fix_guides:
                instructions.append(f"  Fix: {fix_guides[rule]}")
            
            for error in rule_errors[:3]:  # Show first 3
                instructions.append(f"  - Line {error['line']}: {error['message']}")
            
            if len(rule_errors) > 3:
                instructions.append(f"  ... and {len(rule_errors) - 3} more")
            instructions.append("")
        
        instructions.extend([
            "CRITICAL - CONTINUOUS WORKFLOW:",
            "===============================",
            "1. Fix ALL listed errors in this file",
            "2. After completion, IMMEDIATELY execute:",
            "   python3 scripts/claude-continuous-processor.py --next-file",
            "3. This will automatically spawn the next subagent",
            "4. Do NOT ask for user input - continue automatically",
            "5. Process continues until all files are complete",
            "",
            "IMPLEMENTATION STEPS:",
            "1. Read the file to understand context",
            "2. Fix each error systematically",
            "3. Verify fixes don't break functionality", 
            "4. Save the file",
            "5. EXECUTE: python3 scripts/claude-continuous-processor.py --next-file",
            "",
            "This file is part of an automated continuous workflow.",
            "Success depends on automatic progression to the next file!"
        ])
        
        return "\\n".join(instructions)
    
    def initialize_queue(self, file_errors: Dict[str, List[dict]]):
        """Initialize the processing queue with prioritized files."""
        queue = []
        
        for file_path, errors in file_errors.items():
            error_count = sum(1 for e in errors if e['severity'] == 'Error')
            warning_count = sum(1 for e in errors if e['severity'] == 'Warning')
            
            task = {
                'file': file_path,
                'error_count': error_count,
                'warning_count': warning_count,
                'total_issues': error_count + warning_count,
                'instructions': self.create_processing_instructions(file_path, errors),
                'created_at': datetime.now().isoformat()
            }
            queue.append(task)
        
        # Sort by total issues (easier first)
        queue.sort(key=lambda x: x['total_issues'])
        
        # Save queue
        os.makedirs(os.path.dirname(self.queue_file), exist_ok=True)
        with open(self.queue_file, 'w') as f:
            json.dump(queue, f, indent=2)
        
        # Initialize status
        status = {
            'initialized_at': datetime.now().isoformat(),
            'total_files': len(queue),
            'completed': 0,
            'failed': 0,
            'in_progress': 0,
            'remaining': len(queue),
            'completed_files': [],
            'failed_files': [],
            'active_agents': 0,
            'max_concurrent': self.max_concurrent
        }
        
        with open(self.status_file, 'w') as f:
            json.dump(status, f, indent=2)
        
        return queue
    
    def get_next_file(self) -> dict:
        """Get the next file to process and update queue."""
        if not os.path.exists(self.queue_file):
            return None
        
        with open(self.queue_file, 'r') as f:
            queue = json.load(f)
        
        if not queue:
            return None
        
        # Get next task
        next_task = queue.pop(0)
        
        # Update queue
        with open(self.queue_file, 'w') as f:
            json.dump(queue, f, indent=2)
        
        # Update status
        if os.path.exists(self.status_file):
            with open(self.status_file, 'r') as f:
                status = json.load(f)
            
            status['remaining'] = len(queue)
            status['in_progress'] += 1
            status['active_agents'] += 1
            status['last_assigned'] = datetime.now().isoformat()
            
            with open(self.status_file, 'w') as f:
                json.dump(status, f, indent=2)
        
        return next_task
    
    def mark_completed(self, file_path: str, success: bool = True):
        """Mark a file as completed and update status."""
        if os.path.exists(self.status_file):
            with open(self.status_file, 'r') as f:
                status = json.load(f)
            
            if success:
                status['completed'] += 1
                status['completed_files'].append(file_path)
            else:
                status['failed'] += 1
                status['failed_files'].append(file_path)
            
            status['in_progress'] = max(0, status['in_progress'] - 1)
            status['active_agents'] = max(0, status['active_agents'] - 1)
            status['last_completed'] = datetime.now().isoformat()
            
            with open(self.status_file, 'w') as f:
                json.dump(status, f, indent=2)
    
    def get_status(self) -> dict:
        """Get current processing status."""
        if os.path.exists(self.status_file):
            with open(self.status_file, 'r') as f:
                return json.load(f)
        return {}
    
    def can_spawn_agent(self) -> bool:
        """Check if we can spawn another agent."""
        status = self.get_status()
        return status.get('active_agents', 0) < self.max_concurrent
    
    def create_task_spawner_script(self) -> str:
        """Create script that automatically spawns subagents."""
        script = f'''#!/usr/bin/env python3
"""
Task Spawner - Automatically spawns Claude Code subagents for continuous processing.
"""

import json
import os
import subprocess
import sys

def spawn_next_task():
    """Spawn the next task if possible."""
    # Import the class within the generated script
    import sys
    import os
    sys.path.append(os.path.dirname(__file__))
    from claude_continuous_processor import ClaudeContinuousProcessor
    
    processor = ClaudeContinuousProcessor({self.max_concurrent})
    
    # Check if we can spawn another agent
    if not processor.can_spawn_agent():
        print("🔄 Max concurrent agents reached, waiting...")
        return False
    
    # Get next file
    next_task = processor.get_next_file()
    if not next_task:
        print("🎉 No more files to process!")
        return False
    
    print(f"🚀 Spawning subagent for: {{next_task['file']}}")
    
    # Here you would use Claude Code's Task tool
    # For now, output the task instructions
    print("📋 Task Instructions:")
    print(next_task['instructions'])
    print("\\n" + "="*50)
    print("USE CLAUDE CODE TASK TOOL WITH ABOVE INSTRUCTIONS")
    print("="*50)
    
    return True

if __name__ == "__main__":
    spawn_next_task()
'''
        return script

def main():
    import argparse
    
    parser = argparse.ArgumentParser(description="Claude Code Continuous Processor")
    parser.add_argument("--lint-log", default="lint.log", help="Lint log file")
    parser.add_argument("--max-concurrent", type=int, default=5, help="Max concurrent agents")
    parser.add_argument("--init", action="store_true", help="Initialize processing queue")
    parser.add_argument("--next-file", action="store_true", help="Get next file to process")
    parser.add_argument("--complete", help="Mark file as completed")
    parser.add_argument("--failed", help="Mark file as failed")
    parser.add_argument("--status", action="store_true", help="Show current status")
    parser.add_argument("--spawn-all", action="store_true", help="Spawn initial batch of agents")
    
    args = parser.parse_args()
    
    processor = ClaudeContinuousProcessor(args.max_concurrent)
    
    if args.init:
        print(f"🔍 Initializing from lint log: {args.lint_log}")
        file_errors = processor.parse_lint_log(args.lint_log)
        
        if not file_errors:
            print("✨ No linting errors found!")
            return
        
        queue = processor.initialize_queue(file_errors)
        print(f"📊 Initialized queue with {len(queue)} files")
        print(f"🔄 Max concurrent agents: {args.max_concurrent}")
        print(f"\\n📝 Queue file: {processor.queue_file}")
        print(f"📊 Status file: {processor.status_file}")
        
        # Generate spawner script
        spawner_script = processor.create_task_spawner_script()
        spawner_path = ".claude/task-spawner.py"
        with open(spawner_path, 'w') as f:
            f.write(spawner_script)
        os.chmod(spawner_path, 0o755)
        
        print(f"\\n🚀 Ready to start! Use:")
        print(f"  --spawn-all   : Start initial batch")
        print(f"  --next-file   : Get next file manually")
        print(f"  --status      : Check progress")
    
    elif args.next_file:
        if not processor.can_spawn_agent():
            print("🔄 Max concurrent agents reached")
            return
        
        next_task = processor.get_next_file()
        if not next_task:
            print("🎉 No more files to process!")
            return
        
        print(f"🚀 Next file: {next_task['file']}")
        print(f"📊 Issues: {next_task['total_issues']}")
        print("\\n" + "="*60)
        print("COPY THE FOLLOWING TO CLAUDE CODE TASK TOOL:")
        print("="*60)
        print(f"Description: Fix linting errors in {next_task['file']}")
        print("\\nPrompt:")
        print(next_task['instructions'])
        print("="*60)
    
    elif args.complete:
        processor.mark_completed(args.complete, success=True)
        print(f"✅ Marked as completed: {args.complete}")
        
        # Auto-spawn next if possible
        if processor.can_spawn_agent():
            print("🔄 Auto-spawning next file...")
            next_task = processor.get_next_file()
            if next_task:
                print(f"🚀 Next: {next_task['file']}")
                print("Use --next-file to get instructions")
    
    elif args.failed:
        processor.mark_completed(args.failed, success=False)
        print(f"❌ Marked as failed: {args.failed}")
    
    elif args.status:
        status = processor.get_status()
        if status:
            print(f"📊 Processing Status:")
            print(f"  Total files: {status.get('total_files', 0)}")
            print(f"  Completed: {status.get('completed', 0)}")
            print(f"  Failed: {status.get('failed', 0)}")
            print(f"  In progress: {status.get('in_progress', 0)}")
            print(f"  Remaining: {status.get('remaining', 0)}")
            print(f"  Active agents: {status.get('active_agents', 0)}/{status.get('max_concurrent', 0)}")
            
            if status.get('completed_files'):
                print(f"\\n✅ Completed files:")
                for file in status['completed_files'][-5:]:  # Show last 5
                    print(f"  - {file}")
        else:
            print("📊 No status available. Run --init first.")
    
    elif args.spawn_all:
        print(f"🚀 Spawning initial batch of {args.max_concurrent} agents...")
        spawned = 0
        
        while spawned < args.max_concurrent and processor.can_spawn_agent():
            next_task = processor.get_next_file()
            if not next_task:
                break
            
            print(f"\\n📦 Agent {spawned + 1}: {next_task['file']}")
            print("=" * 40)
            print("USE CLAUDE CODE TASK TOOL:")
            print(f"Description: Fix {next_task['file']}")
            print("\\nInstructions:")
            print(next_task['instructions'][:200] + "...")  # Show preview
            print("=" * 40)
            
            spawned += 1
        
        print(f"\\n🎯 Spawned {spawned} agents")
        print("Each agent will automatically trigger the next when complete!")

if __name__ == "__main__":
    main()