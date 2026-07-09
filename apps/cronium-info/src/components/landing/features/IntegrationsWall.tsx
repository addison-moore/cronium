/**
 * The seven tool integrations Cronium actually ships
 * (see `apps/cronium-app/src/tools/plugins/`). Keep this list in sync with the
 * plugins directory — a logo here that has no plugin is a claim we can't back.
 *
 * Marks are trademarks of their owners and are shown unaltered. See NOTICE.md
 * in `public/assets/integrations/`.
 */
const INTEGRATIONS = [
  { name: "Slack", file: "slack.svg" },
  { name: "Discord", file: "discord.svg" },
  { name: "Microsoft Teams", file: "teams.svg" },
  { name: "Notion", file: "notion.svg" },
  { name: "Trello", file: "trello.svg" },
  { name: "Google Sheets", file: "google-sheets.svg" },
  { name: "Email", file: "email.svg" },
] as const;

export default function IntegrationsWall() {
  return (
    <ul
      role="list"
      className="mx-auto grid max-w-4xl grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-7"
    >
      {INTEGRATIONS.map((integration) => (
        <li key={integration.name} className="flex flex-col items-center gap-3">
          {/*
            Each mark sits on a light chip in both themes. Notion's mark is solid
            black and would vanish on a dark background; recolouring a brand mark
            to fix that is not an option, so the background is held constant.
          */}
          <span className="flex h-16 w-16 items-center justify-center rounded-xl border border-slate-200 bg-white shadow-sm">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`/assets/integrations/${integration.file}`}
              alt={integration.name}
              width={32}
              height={32}
              loading="lazy"
              decoding="async"
              className="h-8 w-8 object-contain"
            />
          </span>
          <span className="text-muted-foreground text-center text-xs">
            {integration.name}
          </span>
        </li>
      ))}
    </ul>
  );
}
