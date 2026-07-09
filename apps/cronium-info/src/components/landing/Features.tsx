import Highlights from "./features/Highlights";
import FeatureGrid from "./features/FeatureGrid";

/**
 * Server component. The old version was marked "use client" but used no hooks
 * or handlers, so it shipped JS for nothing.
 *
 * Structure: the three flagship capabilities lead, then the rest of the feature
 * set as a grid of cards that link into the docs.
 */
export default function Features() {
  return (
    <section id="features" className="bg-background py-16 md:py-24">
      <div className="container mx-auto max-w-7xl px-4 md:px-6">
        <div className="mb-16 space-y-4 text-center">
          <h2 className="text-foreground text-3xl font-bold tracking-tight sm:text-4xl md:text-5xl">
            Everything you need to automate
          </h2>
          <p className="text-muted-foreground mx-auto max-w-3xl text-lg">
            Schedule scripts, chain them into workflows, and run them on your
            own servers — with the integrations and guardrails already built in.
          </p>
        </div>

        <Highlights />

        <div className="mt-24">
          <FeatureGrid />
        </div>
      </div>
    </section>
  );
}
