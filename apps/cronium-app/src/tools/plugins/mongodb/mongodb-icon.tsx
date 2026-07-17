import React from "react";

export function MongoDbIcon({
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
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      {/* Leaf silhouette */}
      <path d="M12 2C9 6 7 9 7 12.5C7 16.5 9.5 19 12 20.5C14.5 19 17 16.5 17 12.5C17 9 15 6 12 2Z" />
      <path d="M12 8V22" />
    </svg>
  );
}
