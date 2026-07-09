import Link from "next/link";
import {
  Activity,
  Bell,
  Brain,
  Clock,
  Key,
  Server,
  Terminal,
  Users,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import type { Feature, FeatureIcon } from "./feature-data";

const ICONS: Record<FeatureIcon, LucideIcon> = {
  workflow: Workflow,
  server: Server,
  clock: Clock,
  terminal: Terminal,
  users: Users,
  activity: Activity,
  key: Key,
  brain: Brain,
  bell: Bell,
};

/**
 * A card is a link. The hover treatment (lift, shadow, title colour) used to
 * sit on an inert <div>, which promised a click target that did not exist.
 */
export default function FeatureCard({ feature }: { feature: Feature }) {
  const Icon = ICONS[feature.icon];

  return (
    <Link
      href={feature.href}
      className="group border-border bg-card focus-visible:ring-ring focus-visible:ring-offset-background block rounded-2xl border p-6 transition-all duration-300 hover:-translate-y-1 hover:shadow-lg focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
    >
      <div className="from-primary/10 to-primary/20 text-primary mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br transition-transform duration-300 group-hover:scale-110">
        <Icon className="h-6 w-6" aria-hidden="true" />
      </div>

      <h3 className="group-hover:text-primary text-card-foreground mb-3 text-lg font-semibold transition-colors">
        {feature.title}
      </h3>
      <p className="text-muted-foreground text-sm leading-relaxed">
        {feature.description}
      </p>
    </Link>
  );
}
