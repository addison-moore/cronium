#!/usr/bin/env python3
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
    
    processor = ClaudeContinuousProcessor(5)
    
    # Check if we can spawn another agent
    if not processor.can_spawn_agent():
        print("🔄 Max concurrent agents reached, waiting...")
        return False
    
    # Get next file
    next_task = processor.get_next_file()
    if not next_task:
        print("🎉 No more files to process!")
        return False
    
    print(f"🚀 Spawning subagent for: {next_task['file']}")
    
    # Here you would use Claude Code's Task tool
    # For now, output the task instructions
    print("📋 Task Instructions:")
    print(next_task['instructions'])
    print("\n" + "="*50)
    print("USE CLAUDE CODE TASK TOOL WITH ABOVE INSTRUCTIONS")
    print("="*50)
    
    return True

if __name__ == "__main__":
    spawn_next_task()
