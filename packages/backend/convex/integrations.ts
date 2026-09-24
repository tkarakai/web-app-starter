import { authedQuery } from "./functions";

type ProviderState = "connected" | "not_connected";

type ProviderStatus = {
  value: string;
  label: string;
  status: ProviderState;
  summary: string;
  requiredEnv: string[];
  docsUrl: string;
};

function hasAllEnv(keys: string[]): boolean {
  return keys.every((key) => {
    const value = process.env[key];
    return typeof value === "string" && value.trim().length > 0;
  });
}

function withStatus(args: {
  value: string;
  label: string;
  connected: boolean;
  connectedSummary: string;
  notConnectedSummary: string;
  requiredEnv: string[];
  docsUrl: string;
}): ProviderStatus {
  return {
    value: args.value,
    label: args.label,
    status: args.connected ? "connected" : "not_connected",
    summary: args.connected ? args.connectedSummary : args.notConnectedSummary,
    requiredEnv: args.requiredEnv,
    docsUrl: args.docsUrl,
  };
}

export const getStatus = authedQuery({
  args: {},
  handler: async (ctx) => {
    const role = (ctx.user as Record<string, unknown>).role;
    if (role !== "admin") return null;

    const resendConnected = hasAllEnv(["RESEND_API_KEY", "EMAIL_FROM"]);
    const sentryConnected = hasAllEnv(["SENTRY_DSN"]);
    const twilioConnected = hasAllEnv([
      "TWILIO_ACCOUNT_SID",
      "TWILIO_AUTH_TOKEN",
      "TWILIO_FROM_NUMBER",
    ]);

    return {
      checkedAt: Date.now(),
      email: [
        withStatus({
          value: "resend",
          label: "Resend",
          connected: resendConnected,
          connectedSummary:
            "Resend is configured for transactional and authentication email delivery.",
          notConnectedSummary:
            "Set RESEND_API_KEY and EMAIL_FROM in Convex environment variables.",
          requiredEnv: ["RESEND_API_KEY", "EMAIL_FROM"],
          docsUrl: "https://resend.com/docs",
        }),
        withStatus({
          value: "mailgun",
          label: "Mailgun",
          connected: false,
          connectedSummary: "Mailgun is configured.",
          notConnectedSummary:
            "Mailgun adapter is not wired in this starter yet. Use Resend for now.",
          requiredEnv: ["MAILGUN_API_KEY", "MAILGUN_DOMAIN"],
          docsUrl: "https://documentation.mailgun.com",
        }),
        withStatus({
          value: "postmark",
          label: "Postmark",
          connected: false,
          connectedSummary: "Postmark is configured.",
          notConnectedSummary:
            "Postmark adapter is not wired in this starter yet. Use Resend for now.",
          requiredEnv: ["POSTMARK_SERVER_TOKEN", "POSTMARK_MESSAGE_STREAM"],
          docsUrl: "https://postmarkapp.com/developer",
        }),
      ],
      sms: [
        withStatus({
          value: "twilio",
          label: "Twilio",
          connected: twilioConnected,
          connectedSummary: "Twilio credentials are present for SMS delivery.",
          notConnectedSummary:
            "Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_FROM_NUMBER to enable SMS.",
          requiredEnv: [
            "TWILIO_ACCOUNT_SID",
            "TWILIO_AUTH_TOKEN",
            "TWILIO_FROM_NUMBER",
          ],
          docsUrl: "https://www.twilio.com/docs",
        }),
      ],
      observability: [
        withStatus({
          value: "sentry",
          label: "Sentry",
          connected: sentryConnected,
          connectedSummary: "Sentry DSN is configured for error monitoring.",
          notConnectedSummary:
            "Set SENTRY_DSN in Convex environment variables.",
          requiredEnv: ["SENTRY_DSN"],
          docsUrl: "https://docs.sentry.io/platforms/javascript/guides/nextjs/",
        }),
        withStatus({
          value: "datadog",
          label: "Datadog",
          connected: false,
          connectedSummary: "Datadog is configured.",
          notConnectedSummary: "Datadog integration scaffolding is not yet implemented.",
          requiredEnv: ["DATADOG_API_KEY"],
          docsUrl: "https://docs.datadoghq.com",
        }),
        withStatus({
          value: "new-relic",
          label: "New Relic",
          connected: false,
          connectedSummary: "New Relic is configured.",
          notConnectedSummary: "New Relic integration scaffolding is not yet implemented.",
          requiredEnv: ["NEW_RELIC_LICENSE_KEY"],
          docsUrl: "https://docs.newrelic.com/docs/browser/browser-monitoring/getting-started/introduction-browser-monitoring/",
        }),
        withStatus({
          value: "grafana",
          label: "Grafana",
          connected: false,
          connectedSummary: "Grafana is configured.",
          notConnectedSummary: "Grafana integration scaffolding is not yet implemented.",
          requiredEnv: ["GRAFANA_CLOUD_API_KEY"],
          docsUrl: "https://grafana.com/docs/",
        }),
      ],
    };
  },
});
