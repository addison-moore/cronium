import React from "react";

interface EmailIconProps {
  size?: number;
  className?: string;
}

export function EmailIcon({ size = 24, className = "" }: EmailIconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="m4 4 16 0 0 16 -16 0 z" />
      <path d="m4 6 8 6 8 -6" />
    </svg>
  );
}
