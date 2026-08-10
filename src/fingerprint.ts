import { createHash } from "node:crypto";

import { CHANNELS, PURPOSES } from "./types.js";
import type { SalesAction } from "./types.js";

const OFFSET_TIMESTAMP = /(?:Z|[+-]\d{2}:\d{2})$/u;

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function createActionFingerprint(action: SalesAction): string {
  if (!action.id || !action.customer?.id || typeof action.content !== "string") {
    throw new Error("A valid action, customer reference, and content are required for fingerprinting.");
  }

  if (!OFFSET_TIMESTAMP.test(action.scheduledAt) || Number.isNaN(new Date(action.scheduledAt).getTime())) {
    throw new Error("Scheduled time must include an explicit offset before fingerprinting.");
  }

  if (
    action.offer?.discountPercent !== undefined &&
    (!Number.isFinite(action.offer.discountPercent) ||
      action.offer.discountPercent < 0 ||
      action.offer.discountPercent > 100)
  ) {
    throw new Error("Discount must be finite before fingerprinting.");
  }

  if (
    action.offer?.totalMinorUnits !== undefined &&
    (!Number.isSafeInteger(action.offer.totalMinorUnits) || action.offer.totalMinorUnits < 0)
  ) {
    throw new Error("Offer total must be a safe integer before fingerprinting.");
  }


  if (action.offer?.currency !== undefined && !/^[A-Z]{3}$/u.test(action.offer.currency)) {
    throw new Error("Currency must be a three-letter uppercase code before fingerprinting.");
  }

  const scheduledAt = new Date(action.scheduledAt).toISOString();
  const consent = CHANNELS.flatMap((channel) =>
    PURPOSES.flatMap((purpose) => {
      const record = action.customer.consent[channel]?.[purpose];
      return record
        ? [{
            channel,
            purpose,
            status: record.status,
            capturedAt: record.capturedAt ?? null,
            source: record.source ?? null,
          }]
        : [];
    }),
  );
  const contactHistory = action.contactHistory
    .map((event) => ({
      at: new Date(event.at).toISOString(),
      channel: event.channel,
      purpose: event.purpose,
    }))
    .sort((left, right) => {
      const leftValue = JSON.stringify(left);
      const rightValue = JSON.stringify(right);
      return leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0;
    });
  const canonicalAction = {
    version: 1,
    actionIdHash: sha256(action.id),
    customerIdHash: sha256(action.customer.id),
    channel: action.channel,
    purpose: action.purpose,
    scheduledAt,
    contentHash: sha256(action.content),
    customerContext: {
      timezone: action.customer.timezone,
      locale: action.customer.locale ?? null,
      consent,
      optedOutChannels: [...new Set(action.customer.optedOutChannels)].sort(),
    },
    contactHistory,
    offer: action.offer
      ? {
          discountPercent: action.offer.discountPercent ?? null,
          totalMinorUnits: action.offer.totalMinorUnits ?? null,
          currency: action.offer.currency ?? null,
        }
      : null,
  };

  return sha256(JSON.stringify(canonicalAction));
}

export function hashIdentifier(value: string): string {
  return sha256(value);
}
