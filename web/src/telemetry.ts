/** Visitor counts, by place rather than by person.
 *
 *  Application Insights derives city/state/country from the request IP at
 *  ingestion and discards the address, so this reports geography without
 *  holding anything personal. Cookies are off for the same reason: it costs
 *  the ability to tell a returning visitor from a new one, and buys not
 *  needing a consent banner.
 *
 *  Silent unless VITE_APPINSIGHTS_CONNECTION_STRING is set, so local
 *  development and `npm run dev` send nothing.
 */
import { ApplicationInsights } from "@microsoft/applicationinsights-web";

const CONNECTION = import.meta.env.VITE_APPINSIGHTS_CONNECTION_STRING;

/** The hash is the route here, so a page view is "which hash are we on". */
function currentPage(): string {
  return window.location.pathname + (window.location.hash || "#/");
}

export function startTelemetry(): void {
  if (!CONNECTION) return;

  const ai = new ApplicationInsights({
    config: {
      connectionString: CONNECTION,
      disableCookiesUsage: true,
      // This app routes on the hash; the built-in route tracker watches the
      // History API and would report one page view for the whole session.
      enableAutoRouteTracking: false,
      disableFetchTracking: false,
    },
  });
  ai.loadAppInsights();

  // Where the visitor came from. Only the first view of a session carries a
  // referrer -- once they are clicking around inside the app, the referrer is
  // this app. Cross-origin referrers are trimmed to the origin by the sending
  // site, so GitHub arrives as "https://github.com/", not the exact page.
  const referrer = document.referrer || "(direct)";
  let first = true;

  let last = "";
  const track = () => {
    const name = currentPage();
    if (name === last) return;          // hashchange fires on identical hashes
    last = name;
    ai.trackPageView({
      name,
      uri: name,
      properties: { referrer: first ? referrer : "(internal)" },
    });
    first = false;
  };

  track();
  window.addEventListener("hashchange", track);
}
