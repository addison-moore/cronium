"use client";

import { useRef, useState } from "react";
import Editor from "@monaco-editor/react";
import { EventType } from "@/shared/schema";
import { Spinner } from "@/components/ui/spinner";

interface CodeEditorProps {
  value: string;
  onChange: (value: string) => void;
  scriptType: EventType;
  disabled?: boolean;
  height?: string;
}

export default function CodeEditor({
  value,
  onChange,
  scriptType,
  disabled = false,
  height = "500px",
}: CodeEditorProps) {
  const editorRef = useRef<any>(null);
  const [isLoading, setIsLoading] = useState(true);

  const handleEditorDidMount = (editor: any) => {
    editorRef.current = editor;
    setIsLoading(false);
  };

  const getLanguage = (type: EventType): string => {
    switch (type) {
      case EventType.NODEJS:
        return "javascript";
      case EventType.PYTHON:
        return "python";
      case EventType.BASH:
        return "shell";
      default:
        return "javascript";
    }
  };

  const getExampleCode = (type: EventType): string => {
    if (value) return value;

    switch (type) {
      case EventType.NODEJS:
        return `// Example JavaScript script
console.log('Hello, Cronium!');

// Your script logic goes here
function main() {
  console.log('Starting script execution...');
  
  // Example: fetch data from an API
  fetch('https://api.example.com/data')
    .then(response => response.json())
    .then(data => {
      console.log('Data received:', data);
    })
    .catch(error => {
      console.error('Error fetching data:', error);
    });
}

main();`;
      case EventType.PYTHON:
        return `# Example Python script
import requests
import json
from datetime import datetime

print("Hello, Cronium!")

def main():
    print(f"Starting script execution at {datetime.now()}")
    
    try:
        # Example: fetch data from an API
        response = requests.get('https://api.example.com/data')
        data = response.json()
        print(f"Data received: {json.dumps(data, indent=2)}")
    except Exception as e:
        print(f"Error fetching data: {e}")

if __name__ == "__main__":
    main()`;
      case EventType.BASH:
        return `#!/bin/bash
# Example Bash script

echo "Hello, Cronium!"

# Your script logic goes here
echo "Starting script execution..."

# Example: Make an API request
response=$(curl -s https://api.example.com/data)
echo "Data received: $response"

# Example: Process some files
echo "Processing files..."
for file in /path/to/files/*.txt; do
  echo "Processing $file"
  # Add your file processing logic here
done

echo "Script execution completed!"`;

      default:
        return "// Add your script code here";
    }
  };

  return (
    <div className="overflow-hidden rounded-md border">
      {isLoading && (
        <div className="flex h-[500px] items-center justify-center bg-gray-50">
          <Spinner size="lg" variant="primary" />
        </div>
      )}
      <Editor
        height={height}
        language={getLanguage(scriptType)}
        value={getExampleCode(scriptType)}
        theme="vs-dark"
        onChange={(value) => onChange(value || "")}
        onMount={handleEditorDidMount}
        options={{
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          wordWrap: "on",
          readOnly: disabled,
        }}
      />
    </div>
  );
}
