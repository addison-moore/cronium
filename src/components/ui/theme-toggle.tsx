"use client";

import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { Label } from "@/components/ui/label";
import { Moon, Sun, Monitor } from "lucide-react";
import { Button } from "./button";

export function ThemeToggle({ showLabel = true }: { showLabel?: boolean }) {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  // Avoid hydration mismatch by only rendering after mounting client-side
  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return <div className="h-9 w-[70px] rounded-md bg-muted animate-pulse" />;
  }

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center justify-between mb-3">
        {showLabel && (
          <Label htmlFor="theme-toggle" className="text-base font-medium">
            Dark Mode
          </Label>
        )}
      </div>

      <div className="grid grid-cols-3 gap-2">
        <Button
          variant={theme === "light" ? "default" : "outline"}
          size="sm"
          onClick={() => setTheme("light")}
          className="w-full"
        >
          <Sun className="h-4 w-4 mr-1" />
          Light
        </Button>
        <Button
          variant={theme === "dark" ? "default" : "outline"}
          size="sm"
          onClick={() => setTheme("dark")}
          className="w-full"
        >
          <Moon className="h-4 w-4 mr-1" />
          Dark
        </Button>
        <Button
          variant={theme === "system" ? "default" : "outline"}
          size="sm"
          onClick={() => setTheme("system")}
          className="w-full"
        >
          <Monitor className="h-4 w-4 mr-1" />
          System
        </Button>
      </div>
    </div>
  );
}
