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
    return <div className="bg-muted h-9 w-[70px] animate-pulse rounded-md" />;
  }

  return (
    <div className="border-border bg-card rounded-lg border p-4">
      <div className="mb-3 flex items-center justify-between">
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
          <Sun className="mr-1 h-4 w-4" />
          Light
        </Button>
        <Button
          variant={theme === "dark" ? "default" : "outline"}
          size="sm"
          onClick={() => setTheme("dark")}
          className="w-full"
        >
          <Moon className="mr-1 h-4 w-4" />
          Dark
        </Button>
        <Button
          variant={theme === "system" ? "default" : "outline"}
          size="sm"
          onClick={() => setTheme("system")}
          className="w-full"
        >
          <Monitor className="mr-1 h-4 w-4" />
          System
        </Button>
      </div>
    </div>
  );
}
