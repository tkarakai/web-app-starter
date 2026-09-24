import { v } from "convex/values";

import { internal } from "./_generated/api";
import { internalAction, internalMutation } from "./_generated/server";
import { entitlementsForPlan, generateLicenseKey, type PlanId } from "./commerce";
import { sendAuthEmail } from "./sendAuthEmail";

type WebhookOrderStatus = "paid" | "refunded" | "chargeback";

type ParsedEvent = {
  eventId: string;
  eventName: string;
  providerOrderId: string;
  providerCustomerId: string | null;
  email: string;
  planId: PlanId;
  amountCents: number;
  currency: string;
  status: WebhookOrderStatus;
};

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};
}

function toNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parsePlanId(value: string | null): PlanId {
  if (!value) return "starter";
  const normalized = value.toLowerCase();
  if (normalized.includes("team")) return "team";
  if (normalized.includes("pro")) return "pro";
  return "starter";
}

function parseStatus(eventName: string): WebhookOrderStatus {
  const normalized = eventName.toLowerCase();
  if (normalized.includes("chargeback")) return "chargeback";
  if (normalized.includes("refund")) return "refunded";
  return "paid";
}

function parseAmountCents(attributes: Record<string, unknown>): number {
  const total = toNonEmptyString(attributes.total);
  if (total) {
    const parsed = parseInt(total, 10);
    if (!Number.isNaN(parsed)) return parsed;
  }

  const subtotal = toNonEmptyString(attributes.subtotal);
  if (subtotal) {
    const parsed = parseInt(subtotal, 10);
    if (!Number.isNaN(parsed)) return parsed;
  }

  return 0;
}

function parseEvent(payload: string): ParsedEvent {
  const body = JSON.parse(payload) as Record<string, unknown>;
  const meta = asRecord(body.meta);
  const data = asRecord(body.data);
  const attributes = asRecord(data.attributes);

  const eventId =
    toNonEmptyString(data.id) ??
    toNonEmptyString(meta.event_id) ??
    `generated-${crypto.randomUUID()}`;
  const eventName =
    toNonEmptyString(meta.event_name) ??
    toNonEmptyString(body.event_name) ??
    "unknown";

  const providerOrderId =
    toNonEmptyString(attributes.identifier) ??
    toNonEmptyString(attributes.order_id) ??
    toNonEmptyString(data.id) ??
    `order-${eventId}`;

  const providerCustomerId =
    toNonEmptyString(attributes.customer_id) ??
    toNonEmptyString(attributes.user_id) ??
    null;

  const email = (
    toNonEmptyString(attributes.user_email) ??
    toNonEmptyString(attributes.customer_email) ??
    toNonEmptyString(attributes.email) ??
    ""
  ).toLowerCase();

  if (!email || !email.includes("@")) {
    throw new Error("INVALID_WEBHOOK_PAYLOAD: missing customer email");
  }

  const customData = asRecord(meta.custom_data);
  const planHint =
    toNonEmptyString(customData.planId) ??
    toNonEmptyString(attributes.variant_name) ??
    toNonEmptyString(attributes.product_name);

  const planId = parsePlanId(planHint);

  return {
    eventId,
    eventName,
    providerOrderId,
    providerCustomerId,
    email,
    planId,
    amountCents: parseAmountCents(attributes),
    currency: (toNonEmptyString(attributes.currency) ?? "USD").toUpperCase(),
    status: parseStatus(eventName),
  };
}

export const processLemonSqueezyEvent = internalMutation({
  args: {
    payload: v.string(),
    payloadHash: v.string(),
  },
  handler: async (ctx, args) => {
    const parsed = parseEvent(args.payload);

    const existingEvent = await ctx.db
      .query("commerceWebhookEvents")
      .withIndex("by_provider_event", (q) =>
        q.eq("provider", "lemonsqueezy").eq("eventId", parsed.eventId)
      )
      .unique();

    if (existingEvent) {
      return {
        ok: true as const,
        duplicate: true as const,
        eventId: parsed.eventId,
      };
    }

    const now = Date.now();

    if (parsed.providerCustomerId) {
      const existingCustomer = await ctx.db
        .query("commerceCustomers")
        .withIndex("by_provider_customer", (q) =>
          q
            .eq("provider", "lemonsqueezy")
            .eq("providerCustomerId", parsed.providerCustomerId as string)
        )
        .unique();

      if (existingCustomer) {
        await ctx.db.patch(existingCustomer._id, {
          email: parsed.email,
          updatedAt: now,
        });
      } else {
        await ctx.db.insert("commerceCustomers", {
          email: parsed.email,
          provider: "lemonsqueezy",
          providerCustomerId: parsed.providerCustomerId,
          createdAt: now,
          updatedAt: now,
        });
      }
    }

    const existingOrder = await ctx.db
      .query("commerceOrders")
      .withIndex("by_provider_order", (q) =>
        q.eq("provider", "lemonsqueezy").eq("providerOrderId", parsed.providerOrderId)
      )
      .unique();

    let orderId;
    if (existingOrder) {
      await ctx.db.patch(existingOrder._id, {
        providerEventId: parsed.eventId,
        email: parsed.email,
        planId: parsed.planId,
        amountCents: parsed.amountCents,
        currency: parsed.currency,
        status: parsed.status,
        rawPayload: args.payload,
        updatedAt: now,
      });
      orderId = existingOrder._id;
    } else {
      orderId = await ctx.db.insert("commerceOrders", {
        providerOrderId: parsed.providerOrderId,
        provider: "lemonsqueezy",
        providerEventId: parsed.eventId,
        email: parsed.email,
        planId: parsed.planId,
        amountCents: parsed.amountCents,
        currency: parsed.currency,
        status: parsed.status,
        rawPayload: args.payload,
        createdAt: now,
        updatedAt: now,
      });
    }

    if (parsed.status === "paid") {
      const existingLicense = await ctx.db
        .query("licenses")
        .withIndex("by_order", (q) => q.eq("orderId", orderId))
        .unique();

      if (existingLicense) {
        await ctx.db.patch(existingLicense._id, {
          email: parsed.email,
          planId: parsed.planId,
          entitlements: entitlementsForPlan(parsed.planId),
          status: "active",
          revokedAt: undefined,
          updatedAt: now,
        });
      } else {
        const licenseKey = generateLicenseKey();
        await ctx.db.insert("licenses", {
          key: licenseKey,
          email: parsed.email,
          planId: parsed.planId,
          entitlements: entitlementsForPlan(parsed.planId),
          status: "active",
          orderId,
          issuedAt: now,
          createdAt: now,
          updatedAt: now,
        });

        await ctx.scheduler.runAfter(0, internal.commerceWebhooks.sendPurchaseOnboardingEmail, {
          email: parsed.email,
          planId: parsed.planId,
          licenseKey,
        });
      }
    } else {
      const existingLicenses = await ctx.db
        .query("licenses")
        .withIndex("by_order", (q) => q.eq("orderId", orderId))
        .collect();

      for (const license of existingLicenses) {
        await ctx.db.patch(license._id, {
          status: "revoked",
          revokedAt: now,
          updatedAt: now,
        });
      }
    }

    await ctx.db.insert("commerceWebhookEvents", {
      provider: "lemonsqueezy",
      eventId: parsed.eventId,
      eventName: parsed.eventName,
      processedAt: now,
      payloadHash: args.payloadHash,
    });

    return {
      ok: true as const,
      duplicate: false as const,
      eventId: parsed.eventId,
      orderId,
      status: parsed.status,
    };
  },
});

export const sendPurchaseOnboardingEmail = internalAction({
  args: {
    email: v.string(),
    planId: v.union(v.literal("starter"), v.literal("pro"), v.literal("team")),
    licenseKey: v.string(),
  },
  handler: async (_ctx, args) => {
    const docsUrl = process.env.PRIVATE_DOCS_URL ?? "https://github.com";
    const subject = `Your ${args.planId} license is ready`;

    const html = `
      <p>Thanks for your purchase.</p>
      <p>Your <strong>${args.planId}</strong> license key:</p>
      <p style="font-family: monospace; font-size: 16px;"><strong>${args.licenseKey}</strong></p>
      <p>Next steps:</p>
      <ol>
        <li>Open the onboarding docs: <a href="${docsUrl}">${docsUrl}</a></li>
        <li>Set environment variables and deploy staging.</li>
        <li>Run the launch checklist and smoke tests.</li>
      </ol>
    `;

    const text = [
      "Thanks for your purchase.",
      `Your ${args.planId} license key: ${args.licenseKey}`,
      `Onboarding docs: ${docsUrl}`,
      "Next: configure env vars, deploy staging, run launch checklist.",
    ].join("\n");

    await sendAuthEmail({
      to: args.email,
      type: "custom",
      subject,
      html,
      text,
    });
  },
});
