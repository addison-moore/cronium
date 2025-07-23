"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/use-toast";
import { trpc } from "@/lib/trpc";

export interface EditorSettings {
  fontSize: number;
  theme: "vs-dark" | "vs-light" | "hc-black" | "hc-light";
  wordWrap: boolean;
  minimap: boolean;
  lineNumbers: boolean;
}

interface EditorSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSettingsChange: (settings: EditorSettings) => void;
  currentSettings: EditorSettings;
}

const DEFAULT_SETTINGS: EditorSettings = {
  fontSize: 14,
  theme: "vs-dark",
  wordWrap: true,
  minimap: false,
  lineNumbers: true,
};

export default function EditorSettingsModal({
  isOpen,
  onClose,
  onSettingsChange,
  currentSettings,
}: EditorSettingsModalProps) {
  const [settings, setSettings] = useState<EditorSettings>(currentSettings);
  const { toast } = useToast();

  // tRPC mutation for saving editor settings
  const saveSettingsMutation = trpc.settings.updateEditorSettings.useMutation({
    onSuccess: () => {
      onSettingsChange(settings);
      toast({
        title: "Settings saved",
        description: "Editor settings have been updated successfully.",
      });
      onClose();
    },
    onError: (error) => {
      toast({
        title: "Error",
        description:
          error.message || "Failed to save editor settings. Please try again.",
        variant: "destructive",
      });
    },
  });

  useEffect(() => {
    setSettings(currentSettings);
  }, [currentSettings]);

  const handleSave = async () => {
    try {
      await saveSettingsMutation.mutateAsync({
        fontSize: settings.fontSize,
        theme: settings.theme,
        wordWrap: settings.wordWrap,
        minimap: settings.minimap,
        lineNumbers: settings.lineNumbers,
      });
    } catch {
      // Error handled by mutation onError
    }
  };

  const handleReset = () => {
    setSettings(DEFAULT_SETTINGS);
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Editor Settings</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Font Size */}
          <div className="space-y-2">
            <Label htmlFor="fontSize">Font Size</Label>
            <Input
              id="fontSize"
              type="number"
              min="10"
              max="24"
              value={settings.fontSize}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  fontSize: parseInt(e.target.value) || 14,
                })
              }
            />
          </div>

          {/* Theme */}
          <div className="space-y-2">
            <Label htmlFor="theme">Theme</Label>
            <Select
              value={settings.theme}
              onValueChange={(
                value: "vs-dark" | "vs-light" | "hc-black" | "hc-light",
              ) => setSettings({ ...settings, theme: value })}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select theme" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="vs-dark">Dark</SelectItem>
                <SelectItem value="vs-light">Light</SelectItem>
                <SelectItem value="hc-black">High Contrast Dark</SelectItem>
                <SelectItem value="hc-light">High Contrast Light</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Word Wrap */}
          <div className="flex items-center justify-between">
            <Label htmlFor="wordWrap">Word Wrap</Label>
            <input
              id="wordWrap"
              type="checkbox"
              checked={settings.wordWrap}
              onChange={(e) =>
                setSettings({ ...settings, wordWrap: e.target.checked })
              }
              className="h-4 w-4"
            />
          </div>

          {/* Minimap */}
          <div className="flex items-center justify-between">
            <Label htmlFor="minimap">Show Minimap</Label>
            <input
              id="minimap"
              type="checkbox"
              checked={settings.minimap}
              onChange={(e) =>
                setSettings({ ...settings, minimap: e.target.checked })
              }
              className="h-4 w-4"
            />
          </div>

          {/* Line Numbers */}
          <div className="flex items-center justify-between">
            <Label htmlFor="lineNumbers">Show Line Numbers</Label>
            <input
              id="lineNumbers"
              type="checkbox"
              checked={settings.lineNumbers}
              onChange={(e) =>
                setSettings({ ...settings, lineNumbers: e.target.checked })
              }
              className="h-4 w-4"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleReset}>
            Reset to Default
          </Button>
          <Button
            onClick={handleSave}
            disabled={saveSettingsMutation.isPending}
          >
            {saveSettingsMutation.isPending ? "Saving..." : "Save Settings"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
