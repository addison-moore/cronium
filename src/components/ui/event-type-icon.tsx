import { Globe } from "lucide-react";
import { EventType } from "@/shared/schema";
import Image from "next/image";

interface EventTypeIconProps {
  type: EventType;
  className?: string;
  size?: number;
}

export function EventTypeIcon({
  type,
  className = "",
  size = 16,
}: EventTypeIconProps) {
  switch (type) {
    case EventType.PYTHON:
      return (
        <Image
          src="/assets/icons/python.svg"
          alt="Python"
          width={size}
          height={size}
          className={className}
        />
      );
    case EventType.BASH:
      return (
        <Image
          src="/assets/icons/bash.svg"
          alt="Bash"
          width={size}
          height={size}
          className={className}
        />
      );
    case EventType.NODEJS:
      return (
        <Image
          src="/assets/icons/nodejs.svg"
          alt="Node.js"
          width={size}
          height={size}
          className={className}
        />
      );
    case EventType.HTTP_REQUEST:
      return <Globe size={size} className={className} />;
    default:
      return (
        <div
          style={{ width: size, height: size }}
          className={`bg-gray-300 rounded ${className}`}
        />
      );
  }
}

export function getEventTypeDisplayName(type: EventType): string {
  switch (type) {
    case EventType.PYTHON:
      return "Python";
    case EventType.BASH:
      return "Bash";
    case EventType.NODEJS:
      return "Node.js";
    case EventType.HTTP_REQUEST:
      return "HTTP Request";
    default:
      return "Unknown";
  }
}
