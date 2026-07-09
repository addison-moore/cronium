import Script from "next/script";
import { GA_MEASUREMENT_ID } from "@/lib/site";

/**
 * Google Analytics 4 (gtag.js).
 *
 * Rendered only in production builds, so local `next dev` and test runs don't
 * pollute the property with fake sessions.
 *
 * `afterInteractive` lets the page become interactive before gtag.js loads,
 * which keeps analytics off the critical rendering path. GA4's enhanced
 * measurement picks up App Router client-side navigations via History API
 * events, so no manual page_view call is needed on route change.
 */
export function GoogleAnalytics() {
  if (!GA_MEASUREMENT_ID || process.env.NODE_ENV !== "production") {
    return null;
  }

  return (
    <>
      <Script
        src={`https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`}
        strategy="afterInteractive"
      />
      <Script id="google-analytics" strategy="afterInteractive">
        {`
          window.dataLayer = window.dataLayer || [];
          function gtag(){dataLayer.push(arguments);}
          gtag('js', new Date());
          gtag('config', '${GA_MEASUREMENT_ID}');
        `}
      </Script>
    </>
  );
}
