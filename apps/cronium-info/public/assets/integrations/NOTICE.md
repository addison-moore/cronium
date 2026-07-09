# Integration logos — provenance and usage

These marks identify the third-party services Cronium integrates with. They are
shown as **nominative use** — naming the services we interoperate with. They do
not imply sponsorship, affiliation, or endorsement by their owners.

Each mark is the property of its respective owner and is reproduced unaltered.
Do not recolor, invert, distort, or crop them. They are rendered on a neutral
light chip in `IntegrationsWall.tsx` so every mark sits on an approved
background in both light and dark themes (Notion's mark is solid `#000` and
would otherwise disappear on a dark background).

| File                | Source                                                                                                                        |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `slack.svg`         | Official mark, already vendored in `apps/cronium-app`                                                                         |
| `discord.svg`       | Official mark, already vendored in `apps/cronium-app`                                                                         |
| `teams.svg`         | Wikimedia Commons — "Microsoft Office Teams (2025–present).svg"                                                               |
| `notion.svg`        | Wikimedia Commons — "Notion-logo.svg"                                                                                         |
| `google-sheets.svg` | Wikimedia Commons — "Google Sheets icon (2026).svg" (current Workspace mark)                                                  |
| `trello.svg`        | Silhouette from Simple Icons (CC0), filled with Trello brand blue `#0052CC`. Atlassian publishes no icon-only SVG on Commons. |
| `email.svg`         | Not a brand. Neutral envelope drawn from the lucide `Mail` glyph.                                                             |

`email.svg` is deliberately generic: email is a protocol, not a product. Using a
Gmail or Outlook logo here would misrepresent the integration and infringe a
trademark we have no relationship with.

To add an integration, drop its mark here and add an entry to `INTEGRATIONS` in
`src/components/landing/features/IntegrationsWall.tsx`. Keep this table current.
