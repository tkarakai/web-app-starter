import { authedQuery } from "./functions";

// ---------------------------------------------------------------------------
// Integration status for the admin Configure → Integrations page.
// Reports which providers the backend can actually use, based on the Convex
// environment variables it reads. Only providers with an implementation in
// this starter can ever show as connected; the rest list what they would need.
// ---------------------------------------------------------------------------

export type ProviderStatus = {
  value: string;
  label: string;
  status: "connected" | "not_connected" | "not_implemented";
  summary: string;
  requiredEnv: string[];
  docsUrl: string;
};

function hasAllEnv(keys: string[]): boolean {
  return keys.every((key) => (process.env[key] ?? "").trim().length > 0);
}

/** A provider the backend uses: connected when all its env vars are set. */
function implemented(args: {
  value: string;
  label: string;
  requiredEnv: string[];
  connectedSummary: string;
  docsUrl: string;
}): ProviderStatus {
  const connected = hasAllEnv(args.requiredEnv);
  return {
    value: args.value,
    label: args.label,
    status: connected ? "connected" : "not_connected",
    summary: connected
      ? args.connectedSummary
      : `Set ${args.requiredEnv.join(" and ")} in the Convex environment variables.`,
    requiredEnv: args.requiredEnv,
    docsUrl: args.docsUrl,
  };
}

/** A provider with no adapter in this starter yet. */
function notImplemented(args: {
  value: string;
  label: string;
  requiredEnv: string[];
  docsUrl: string;
}): ProviderStatus {
  return {
    ...args,
    status: "not_implemented",
    summary: `${args.label} is not wired into this starter yet.`,
  };
}

/** Provider status grouped by category, read from the current environment. */
export function buildIntegrationStatus() {
  return {
    email: [
      implemented({
        value: "resend",
        label: "Resend",
        requiredEnv: ["RESEND_API_KEY", "EMAIL_FROM"],
        connectedSummary: "Transactional and authentication email is sent through Resend.",
        docsUrl: "https://resend.com/docs",
      }),
      notImplemented({
        value: "mailgun",
        label: "Mailgun",
        requiredEnv: ["MAILGUN_API_KEY", "MAILGUN_DOMAIN"],
        docsUrl: "https://documentation.mailgun.com",
      }),
      notImplemented({
        value: "postmark",
        label: "Postmark",
        requiredEnv: ["POSTMARK_SERVER_TOKEN", "POSTMARK_MESSAGE_STREAM"],
        docsUrl: "https://postmarkapp.com/developer",
      }),
    ],
    sms: [
      notImplemented({
        value: "twilio",
        label: "Twilio",
        requiredEnv: ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM_NUMBER"],
        docsUrl: "https://www.twilio.com/docs",
      }),
    ],
    observability: [
      notImplemented({
        value: "sentry",
        label: "Sentry",
        requiredEnv: ["SENTRY_DSN"],
        docsUrl: "https://docs.sentry.io/platforms/javascript/guides/nextjs/",
      }),
      notImplemented({
        value: "datadog",
        label: "Datadog",
        requiredEnv: ["DATADOG_API_KEY"],
        docsUrl: "https://docs.datadoghq.com",
      }),
      notImplemented({
        value: "new-relic",
        label: "New Relic",
        requiredEnv: ["NEW_RELIC_LICENSE_KEY"],
        docsUrl: "https://docs.newrelic.com",
      }),
      notImplemented({
        value: "grafana",
        label: "Grafana",
        requiredEnv: ["GRAFANA_CLOUD_API_KEY"],
        docsUrl: "https://grafana.com/docs/",
      }),
    ],
  };
}

export const getStatus = authedQuery({
  args: {},
  handler: async (ctx) => {
    if ((ctx.user as Record<string, unknown>).role !== "admin") return null;
    return buildIntegrationStatus();
  },
});
