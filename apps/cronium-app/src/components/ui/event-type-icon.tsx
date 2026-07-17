import { Globe, Wrench } from "lucide-react";
import { EventType } from "@/shared/schema";
import Image from "next/image";
import { SlackIcon } from "@/tools/plugins/slack/slack-icon";
import { DiscordIcon } from "@/tools/plugins/discord/discord-icon";
import { EmailIcon } from "@/tools/plugins/email/email-icon";
import { GoogleSheetsIcon } from "@/tools/plugins/google-sheets/google-sheets-icon";
import { TeamsIcon } from "@/tools/plugins/teams/teams-icon";
import { NotionIcon } from "@/tools/plugins/notion/notion-icon";
import { TrelloIcon } from "@/tools/plugins/trello/trello-icon";
import { SqlIcon } from "@/tools/plugins/sql/sql-icon";

interface EventTypeIconProps {
  type: EventType;
  /** Tool type for TOOL_ACTION events (e.g. "slack", "SLACK", "GOOGLE_SHEETS") */
  toolType?: string | null | undefined;
  className?: string;
  size?: number;
}

const TOOL_ICONS: Record<
  string,
  React.ComponentType<{ size?: number; className?: string }>
> = {
  slack: SlackIcon,
  discord: DiscordIcon,
  email: EmailIcon,
  "google-sheets": GoogleSheetsIcon,
  teams: TeamsIcon,
  notion: NotionIcon,
  trello: TrelloIcon,
  sql: SqlIcon,
};

export function EventTypeIcon({
  type,
  toolType,
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
    case EventType.TOOL_ACTION: {
      // Tool types are stored in mixed casings ("SLACK", "google_sheets", ...);
      // normalize to the plugin id form used as keys above
      const normalized = toolType?.toLowerCase().replace(/_/g, "-");
      const ToolIcon = normalized ? TOOL_ICONS[normalized] : undefined;
      if (ToolIcon) {
        return <ToolIcon size={size} className={className} />;
      }
      return <Wrench size={size} className={className} />;
    }
    default:
      return (
        <div
          style={{ width: size, height: size }}
          className={`rounded bg-gray-300 ${className}`}
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
    case EventType.TOOL_ACTION:
      return "Tool Action";
    default:
      return "Unknown";
  }
}
