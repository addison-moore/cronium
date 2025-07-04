import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import dynamic from "next/dynamic";
import { EventType } from "@/shared/schema";
const CodeEditor = dynamic(() => import("@/components/dashboard/CodeEditor"), {
  ssr: false,
});

export interface HttpHeader {
  key: string;
  value: string;
}

interface HttpRequestFormProps {
  method: string;
  url: string;
  headers: HttpHeader[];
  body: string;
  onMethodChange: (method: string) => void;
  onUrlChange: (url: string) => void;
  onHeadersChange: (headers: HttpHeader[]) => void;
  onBodyChange: (body: string) => void;
}

export default function HttpRequestForm({
  method,
  url,
  headers,
  body,
  onMethodChange,
  onUrlChange,
  onHeadersChange,
  onBodyChange,
}: HttpRequestFormProps) {
  const [activeTab, setActiveTab] = useState("headers");

  const handleAddHeader = () => {
    onHeadersChange([...headers, { key: "", value: "" }]);
  };

  const handleHeaderChange = (
    index: number,
    field: "key" | "value",
    value: string,
  ) => {
    const newHeaders = [...headers];
    newHeaders[index] = {
      key: newHeaders[index]?.key ?? "",
      value: newHeaders[index]?.value ?? "",
      [field]: value,
    };
    onHeadersChange(newHeaders);
  };

  const handleRemoveHeader = (index: number) => {
    onHeadersChange(headers.filter((_, i) => i !== index));
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-4 gap-4">
        <div>
          <Label htmlFor="method">Method</Label>
          <Select value={method} onValueChange={onMethodChange}>
            <SelectTrigger id="method">
              <SelectValue placeholder="GET" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="GET">GET</SelectItem>
              <SelectItem value="POST">POST</SelectItem>
              <SelectItem value="PUT">PUT</SelectItem>
              <SelectItem value="PATCH">PATCH</SelectItem>
              <SelectItem value="DELETE">DELETE</SelectItem>
              <SelectItem value="HEAD">HEAD</SelectItem>
              <SelectItem value="OPTIONS">OPTIONS</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="col-span-3">
          <Label htmlFor="url">URL</Label>
          <Input
            id="url"
            placeholder="https://api.example.com/endpoint"
            value={url}
            onChange={(e) => onUrlChange(e.target.value)}
          />
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList>
          <TabsTrigger value="headers">Headers</TabsTrigger>
          <TabsTrigger value="body">Body</TabsTrigger>
        </TabsList>

        <TabsContent value="headers" className="space-y-4">
          {headers.map((header, index) => (
            <div key={index} className="grid grid-cols-5 items-center gap-2">
              <div className="col-span-2">
                <Input
                  placeholder="Header Name"
                  value={header.key}
                  onChange={(e) =>
                    handleHeaderChange(index, "key", e.target.value)
                  }
                />
              </div>
              <div className="col-span-2">
                <Input
                  placeholder="Value"
                  value={header.value}
                  onChange={(e) =>
                    handleHeaderChange(index, "value", e.target.value)
                  }
                />
              </div>
              <Button
                type="button"
                variant="secondary"
                size="icon"
                onClick={() => handleRemoveHeader(index)}
              >
                ✕
              </Button>
            </div>
          ))}

          <Button
            type="button"
            variant="outline"
            onClick={handleAddHeader}
            className="w-full"
          >
            Add Header
          </Button>
        </TabsContent>

        <TabsContent value="body" className="min-h-[300px]">
          <div className="h-[300px]">
            <CodeEditor
              value={body}
              onChange={onBodyChange}
              scriptType={EventType.BASH}
              height="300px"
            />
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
