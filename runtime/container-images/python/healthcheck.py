#!/usr/bin/env python3
"""
Health check script for Python Cronium container
"""
import sys
import os

def main():
    """Perform basic health checks"""
    try:
        # Check if cronium module can be imported
        import cronium
        
        # Check environment variables are set
        required_env = ['CRONIUM_RUNTIME_API', 'CRONIUM_EXECUTION_TOKEN', 'CRONIUM_EXECUTION_ID']
        
        # In health check mode, these might not be set, so we just check the module loads
        if all(var in os.environ for var in required_env):
            # If env vars are set, verify the module initializes
            _ = cronium.Cronium()
        
        # Check Python version
        if sys.version_info < (3, 12):
            print(f"Python version too old: {sys.version}")
            sys.exit(1)
        
        print("Health check passed")
        sys.exit(0)
        
    except Exception as e:
        print(f"Health check failed: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()