import React from "react";

export function TrelloIcon({
  size = 24,
  className = "",
}: {
  size?: number;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      <rect x="3" y="3" width="18" height="18" rx="3" fill="#0052CC" />
      <rect x="6" y="6" width="5" height="9" rx="1" fill="white" />
      <rect x="13" y="6" width="5" height="5" rx="1" fill="white" />
    </svg>
  );
}
