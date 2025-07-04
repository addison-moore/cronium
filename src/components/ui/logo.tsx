"use client";

import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import Image from "next/image";

interface LogoProps {
  className?: string;
  iconOnly?: boolean;
  size?: "sm" | "md" | "lg";
}

export function Logo({
  className = "",
  iconOnly = false,
  size = "md",
}: LogoProps) {
  const { theme } = useTheme();
  const [mounted, setMounted] = useState(false);

  // Avoid hydration mismatch by mounting after initial render
  useEffect(() => {
    setMounted(true);
  }, []);

  // Size mappings
  const iconSizes = {
    sm: "h-5 w-5",
    md: "h-6 w-6",
    lg: "h-7 w-7",
  };

  const textSizes = {
    sm: "text-lg",
    md: "text-xl",
    lg: "text-2xl",
  };

  // Get the right text color based on theme
  const textColor = !mounted
    ? "text-primary"
    : theme === "dark"
      ? "text-secondary"
      : "text-primary";

  // Get pixel dimensions for the image
  const pixelSizes = {
    sm: 20,
    md: 24,
    lg: 32,
  };

  return (
    <div className={`flex items-center ${className}`}>
      <div
        className={`${iconSizes[size]} relative mr-1.5 flex items-center justify-center`}
      >
        <Image
          src="/assets/logo-icon.svg"
          alt="Cronium Logo"
          width={pixelSizes[size]}
          height={pixelSizes[size]}
          className="object-contain"
        />
      </div>
      {!iconOnly && (
        <span className={`${textSizes[size]} font-semibold ${textColor}`}>
          Cronium
        </span>
      )}
    </div>
  );
}
