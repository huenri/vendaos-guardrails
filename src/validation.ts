import { CHANNELS, PURPOSES } from "./types.js";
import type { RuleResult, SalesAction } from "./types.js";

const OFFSET_TIMESTAMP = /(?:Z|[+-]\d{2}:\d{2})$/u;

function block(code: string, message: string): RuleResult {
  return {
    ruleId: "core.input-validation",
    decision: "block",
    code,
    message,
  };
}

function isNonEmptyBoundedString(value: unknown, maximumLength: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maximumLength;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Object.prototype.toString.call(value) === "[object Object]";
}

function isTimestamp(value: unknown): value is string {
  return (
    typeof value === "string" &&
    OFFSET_TIMESTAMP.test(value) &&
    !Number.isNaN(new Date(value).getTime())
  );
}

function isSupportedChannel(value: unknown): boolean {
  return (CHANNELS as readonly unknown[]).includes(value);
}

function isSupportedPurpose(value: unknown): boolean {
  return (PURPOSES as readonly unknown[]).includes(value);
}

function isIanaTimezone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

export function validateAction(
  action: SalesAction,
  maxContentLength: number,
  maxContactHistoryLength: number,
): RuleResult | null {
  if (!action || typeof action !== "object") {
    return block("INVALID_ACTION", "The proposed action must be an object.");
  }

  if (!isNonEmptyBoundedString(action.id, 256)) {
    return block("INVALID_ACTION_ID", "Action ID must be a non-empty string of at most 256 characters.");
  }

  if (!action.customer || !isNonEmptyBoundedString(action.customer.id, 256)) {
    return block("INVALID_CUSTOMER_ID", "Customer ID must be a non-empty pseudonymous identifier.");
  }

  if (
    !isNonEmptyBoundedString(action.customer.timezone, 128) ||
    !isIanaTimezone(action.customer.timezone)
  ) {
    return block("INVALID_TIMEZONE", "Customer time zone must be a valid IANA time zone.");
  }

  if (
    action.customer.locale !== undefined &&
    !isNonEmptyBoundedString(action.customer.locale, 64)
  ) {
    return block("INVALID_LOCALE", "Customer locale must be a non-empty string of at most 64 characters.");
  }

  if (!isSupportedChannel(action.channel)) {
    return block("INVALID_CHANNEL", "The contact channel is not supported.");
  }

  if (!isSupportedPurpose(action.purpose)) {
    return block("INVALID_PURPOSE", "The contact purpose is not supported.");
  }

  if (typeof action.content !== "string" || action.content.length > maxContentLength) {
    return block(
      "INVALID_CONTENT",
      `Message content must be a string of at most ${maxContentLength} characters.`,
    );
  }

  if (!isTimestamp(action.scheduledAt)) {
    return block("INVALID_SCHEDULE", "Scheduled time must be ISO 8601 with an explicit offset or Z.");
  }

  if (!Array.isArray(action.contactHistory)) {
    return block("MISSING_CONTACT_HISTORY", "Authoritative contact history is required.");
  }

  if (action.contactHistory.length > maxContactHistoryLength) {
    return block(
      "CONTACT_HISTORY_TOO_LARGE",
      `Contact history must contain at most ${maxContactHistoryLength} entries.`,
    );
  }

  for (const event of action.contactHistory) {
    if (
      !isRecord(event) ||
      !isTimestamp(event["at"]) ||
      !isSupportedChannel(event["channel"]) ||
      !isSupportedPurpose(event["purpose"])
    ) {
      return block("INVALID_CONTACT_HISTORY", "Contact history contains a malformed entry.");
    }
  }

  if (!isRecord(action.customer.consent)) {
    return block("MISSING_CONSENT_CONTEXT", "Consent context is required.");
  }

  for (const [channel, purposeRecords] of Object.entries(action.customer.consent)) {
    if (!isSupportedChannel(channel) || !isRecord(purposeRecords)) {
      return block("INVALID_CONSENT_CONTEXT", "Consent context contains a malformed record.");
    }

    for (const [purpose, consent] of Object.entries(purposeRecords)) {
      if (
        !isSupportedPurpose(purpose) ||
        !isRecord(consent) ||
        !["granted", "denied", "unknown"].includes(consent["status"] as string) ||
        (consent["capturedAt"] !== undefined && !isTimestamp(consent["capturedAt"])) ||
        (consent["source"] !== undefined && !isNonEmptyBoundedString(consent["source"], 256))
      ) {
        return block("INVALID_CONSENT_CONTEXT", "Consent context contains a malformed record.");
      }
    }
  }

  if (
    !Array.isArray(action.customer.optedOutChannels) ||
    action.customer.optedOutChannels.some((channel) => !isSupportedChannel(channel))
  ) {
    return block("MISSING_OPTOUT_CONTEXT", "Opt-out context is required.");
  }

  if (action.offer !== undefined) {
    if (!isRecord(action.offer)) {
      return block("INVALID_OFFER", "Commercial offer must be an object.");
    }

    const discountPercent = action.offer["discountPercent"];
    const totalMinorUnits = action.offer["totalMinorUnits"];
    const currency = action.offer["currency"];
    if (
      discountPercent !== undefined &&
      (typeof discountPercent !== "number" ||
        !Number.isFinite(discountPercent) ||
        discountPercent < 0 ||
        discountPercent > 100)
    ) {
      return block("INVALID_DISCOUNT", "Discount percentage must be between 0 and 100.");
    }
    if (
      totalMinorUnits !== undefined &&
      (typeof totalMinorUnits !== "number" ||
        !Number.isSafeInteger(totalMinorUnits) ||
        totalMinorUnits < 0)
    ) {
      return block("INVALID_OFFER_TOTAL", "Offer total must be a non-negative safe integer in minor units.");
    }
    if (currency !== undefined && (typeof currency !== "string" || !/^[A-Z]{3}$/u.test(currency))) {
      return block("INVALID_CURRENCY", "Currency must be a three-letter uppercase code.");
    }
  }

  return null;
}
