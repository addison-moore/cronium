const fs = require("fs");

class Cronium {
  constructor() {
    // Load input data automatically
    try {
      this._inputData = JSON.parse(fs.readFileSync("input.json", "utf8"));
    } catch (error) {
      this._inputData = {};
    }

    // Load event data automatically
    try {
      this._eventData = JSON.parse(fs.readFileSync("event.json", "utf8"));
    } catch (error) {
      this._eventData = {};
    }

    // Initialize condition state
    this._condition = null;
  }

  input() {
    return this._inputData;
  }

  output(data) {
    try {
      fs.writeFileSync("output.json", JSON.stringify(data, null, 2));
    } catch (error) {
      console.error("Error writing output:", error.message);
    }
  }

  event() {
    return this._eventData;
  }

  setCondition(condition) {
    // Convert the condition to a boolean and store it
    this._condition = Boolean(condition);

    // Write the condition result to a file for the executor to read
    try {
      fs.writeFileSync(
        "condition.json",
        JSON.stringify({ condition: this._condition }, null, 2),
      );
    } catch (error) {
      console.error("Error writing condition:", error.message);
    }

    return this._condition;
  }

  getCondition() {
    return this._condition;
  }

  getVariable(key) {
    try {
      const variablesData = JSON.parse(
        fs.readFileSync("variables.json", "utf8"),
      );
      return variablesData[key] || null;
    } catch (error) {
      return null;
    }
  }

  setVariable(key, value) {
    try {
      let variablesData = {};

      // Read existing variables if file exists
      try {
        variablesData = JSON.parse(fs.readFileSync("variables.json", "utf8"));
      } catch (error) {
        // File doesn't exist, use empty object
      }

      // Set the new variable
      variablesData[key] = value;
      variablesData["__updated__"] = new Date().toISOString();

      // Write back to file
      fs.writeFileSync(
        "variables.json",
        JSON.stringify(variablesData, null, 2),
      );

      return true;
    } catch (error) {
      console.error(`Error setting variable ${key}:`, error.message);
      return false;
    }
  }
}

// Create and export cronium instance
const croniumInstance = new Cronium();

// Make cronium globally available
global.cronium = croniumInstance;

module.exports = croniumInstance;
