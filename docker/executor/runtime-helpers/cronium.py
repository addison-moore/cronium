import json
import os
import sys

class Cronium:
    def __init__(self):
        # Load input data automatically
        try:
            with open("input.json", "r") as f:
                self._input_data = json.load(f)
        except FileNotFoundError:
            self._input_data = {}
        except json.JSONDecodeError:
            self._input_data = {}
        
        # Load event data automatically
        try:
            with open("event.json", "r") as f:
                self._event_data = json.load(f)
        except FileNotFoundError:
            self._event_data = {}
        except json.JSONDecodeError:
            self._event_data = {}
        
        # Initialize condition state
        self._condition = None

    def input(self):
        """Get input data"""
        return self._input_data

    def output(self, data):
        """Set output data to output.json file"""
        try:
            with open("output.json", "w") as f:
                json.dump(data, f, indent=2)
        except Exception as e:
            print(f"Error writing output: {e}", file=sys.stderr)

    def event(self):
        """Get event metadata"""
        return self._event_data

    def setCondition(self, condition):
        """Set a condition flag that can be checked by conditional events"""
        # Convert the condition to a boolean and store it
        self._condition = bool(condition)
        
        # Write the condition result to a file for the executor to read
        try:
            with open("condition.json", "w") as f:
                json.dump({"condition": self._condition}, f, indent=2)
        except Exception as e:
            print(f"Error writing condition: {e}", file=sys.stderr)
        
        return self._condition

    def getCondition(self):
        """Get the current condition state"""
        return self._condition

    def getVariable(self, key):
        """Get a variable value by key"""
        try:
            with open("variables.json", "r") as f:
                variables_data = json.load(f)
            return variables_data.get(key)
        except (FileNotFoundError, json.JSONDecodeError):
            return None

    def setVariable(self, key, value):
        """Set a variable value"""
        try:
            # Read existing variables if file exists
            try:
                with open("variables.json", "r") as f:
                    variables_data = json.load(f)
            except (FileNotFoundError, json.JSONDecodeError):
                variables_data = {}
            
            # Set the new variable
            variables_data[key] = value
            from datetime import datetime
            variables_data['__updated__'] = datetime.now().isoformat()
            
            # Write back to file
            with open("variables.json", "w") as f:
                json.dump(variables_data, f, indent=2)
            
            return True
        except Exception as e:
            print(f"Error setting variable {key}: {e}", file=sys.stderr)
            return False

# Create global cronium instance
_cronium_instance = Cronium()

# Export functions at module level for clean API
input = _cronium_instance.input
output = _cronium_instance.output
event = _cronium_instance.event
setCondition = _cronium_instance.setCondition
getCondition = _cronium_instance.getCondition
getVariable = _cronium_instance.getVariable
setVariable = _cronium_instance.setVariable

# Also provide the class for compatibility
cronium = _cronium_instance