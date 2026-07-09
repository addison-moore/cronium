import { ImageResponse } from "next/og";
import { SITE_NAME, SITE_TAGLINE } from "@/lib/site";

// Applies to every route under app/ unless a nested segment overrides it.
export const alt =
  "Cronium — self-hosted automation and job scheduling platform";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    <div
      style={{
        height: "100%",
        width: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-start",
        justifyContent: "center",
        background: "linear-gradient(135deg, #0f172a 0%, #1e293b 100%)",
        padding: "80px",
      }}
    >
      <div
        style={{
          fontSize: 96,
          fontWeight: 700,
          color: "#ffffff",
          letterSpacing: "-0.03em",
        }}
      >
        {SITE_NAME}
      </div>
      <div
        style={{
          marginTop: 24,
          fontSize: 44,
          color: "#38bdf8",
          fontWeight: 600,
        }}
      >
        {SITE_TAGLINE}
      </div>
      <div
        style={{
          marginTop: 32,
          fontSize: 30,
          color: "#cbd5e1",
          maxWidth: 900,
          lineHeight: 1.4,
        }}
      >
        Schedule scripts, build workflows, and run them on your own servers.
        Open source.
      </div>
    </div>,
    { ...size },
  );
}
