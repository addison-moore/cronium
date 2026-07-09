import FeatureCard from "./FeatureCard";
import { FEATURES } from "./feature-data";

export default function FeatureGrid() {
  return (
    <div className="grid grid-cols-1 gap-8 md:grid-cols-2 lg:grid-cols-3">
      {FEATURES.map((feature) => (
        <FeatureCard key={feature.href} feature={feature} />
      ))}
    </div>
  );
}
