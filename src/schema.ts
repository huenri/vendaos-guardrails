import { CHANNELS, CONSENT_STATUSES, PURPOSES } from "./types.js";
import type {
  ApprovalPayload,
  Channel,
  CommercialOffer,
  ConsentRecord,
  ContactEvent,
  ContactPurpose,
  CustomerContext,
  SalesAction,
  SignedApproval,
} from "./types.js";
import { validateAction } from "./validation.js";

const DEFAULT_MAX_CONTENT_LENGTH = 50_000;
const DEFAULT_MAX_CONTACT_HISTORY_LENGTH = 10_000;
const MAXIMUM_ISSUES = 32;

type DataRecord = Record<string, unknown>;

export interface ParseSalesActionOptions {
  readonly maxContentLength?: number;
  readonly maxContactHistoryLength?: number;
  /** Maximum UTF-16 length accepted by `parseSalesActionJson`. Defaults to 1,000,000. */
  readonly maxJsonLength?: number;
  /** Reject fields outside the documented schema. Defaults to true. */
  readonly rejectUnknownFields?: boolean;
}

export interface SalesActionParseIssue {
  /** A bounded schema path that never contains an attacker-controlled field name. */
  readonly path: string;
  readonly code:
    | "INVALID_TYPE"
    | "MISSING_FIELD"
    | "UNKNOWN_FIELD"
    | "INVALID_VALUE"
    | "INPUT_TOO_LARGE"
    | "UNSAFE_OBJECT"
    | "INVALID_ACTION";
  readonly message: string;
}

/** @deprecated Use `SalesActionParseIssue`; kept as an additive compatibility alias. */
export type SchemaIssue = SalesActionParseIssue;

export type SalesActionParseResult =
  | { readonly success: true; readonly value: SalesAction; readonly issues: readonly [] }
  | { readonly success: false; readonly issues: readonly SalesActionParseIssue[] };

interface ParseContext {
  readonly issues: SalesActionParseIssue[];
  readonly rejectUnknownFields: boolean;
  readonly maxContentLength: number;
  readonly maxContactHistoryLength: number;
}

function addIssue(
  context: ParseContext,
  path: string,
  code: SalesActionParseIssue["code"],
  message: string,
): void {
  if (context.issues.length < MAXIMUM_ISSUES) context.issues.push({ path, code, message });
}

/**
 * Machine-readable shape for gateways that already use a JSON Schema validator.
 * `parseSalesAction` remains the authoritative package adapter.
 */
export const SALES_ACTION_JSON_SCHEMA = Object.freeze({
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://github.com/huenri/vendaos-guardrails/schemas/sales-action-v1.json",
  title: "VendaOS SalesAction",
  type: "object",
  additionalProperties: false,
  required: ["id", "customer", "channel", "purpose", "content", "scheduledAt", "contactHistory"],
  properties: {
    id: { type: "string", minLength: 1, maxLength: 256 },
    customer: { $ref: "#/$defs/customer" },
    channel: { enum: CHANNELS },
    purpose: { enum: PURPOSES },
    content: { type: "string" },
    scheduledAt: { type: "string", maxLength: 64 },
    contactHistory: { type: "array", items: { $ref: "#/$defs/contactEvent" } },
    offer: { $ref: "#/$defs/offer" },
    approval: { $ref: "#/$defs/approval" },
  },
  $defs: {
    consentRecord: {
      type: "object",
      additionalProperties: false,
      required: ["status"],
      properties: {
        status: { enum: CONSENT_STATUSES },
        capturedAt: { type: "string", maxLength: 64 },
        source: { type: "string", minLength: 1, maxLength: 256 },
      },
    },
    purposeConsent: {
      type: "object",
      additionalProperties: false,
      properties: Object.fromEntries(PURPOSES.map((purpose) => [purpose, { $ref: "#/$defs/consentRecord" }])),
    },
    consent: {
      type: "object",
      additionalProperties: false,
      properties: Object.fromEntries(CHANNELS.map((channel) => [channel, { $ref: "#/$defs/purposeConsent" }])),
    },
    customer: {
      type: "object",
      additionalProperties: false,
      required: ["id", "timezone", "consent", "optedOutChannels"],
      properties: {
        id: { type: "string", minLength: 1, maxLength: 256 },
        timezone: { type: "string", minLength: 1, maxLength: 128 },
        locale: { type: "string", minLength: 1, maxLength: 64 },
        consent: { $ref: "#/$defs/consent" },
        optedOutChannels: { type: "array", uniqueItems: true, items: { enum: CHANNELS } },
      },
    },
    contactEvent: {
      type: "object",
      additionalProperties: false,
      required: ["at", "channel", "purpose"],
      properties: {
        at: { type: "string", maxLength: 64 },
        channel: { enum: CHANNELS },
        purpose: { enum: PURPOSES },
      },
    },
    offer: {
      type: "object",
      additionalProperties: false,
      properties: {
        discountPercent: { type: "number", minimum: 0, maximum: 100 },
        totalMinorUnits: { type: "integer", minimum: 0 },
        currency: { type: "string", pattern: "^[A-Z]{3}$" },
      },
    },
    approval: {
      type: "object",
      additionalProperties: false,
      required: ["payload", "signature"],
      properties: {
        payload: {
          type: "object",
          additionalProperties: false,
          required: ["version", "actionFingerprint", "policyVersion", "ruleIds", "approvedBy", "approvedAt", "expiresAt", "nonce"],
          properties: {
            version: { const: 1 },
            actionFingerprint: { type: "string", pattern: "^[a-f0-9]{64}$" },
            policyVersion: { type: "string", minLength: 1, maxLength: 128 },
            ruleIds: { type: "array", minItems: 1, maxItems: 64, uniqueItems: true, items: { type: "string", pattern: "^[A-Za-z0-9._:-]{1,128}$" } },
            approvedBy: { type: "string", minLength: 1, maxLength: 256 },
            approvedAt: { type: "string", maxLength: 64 },
            expiresAt: { type: "string", maxLength: 64 },
            nonce: { type: "string", pattern: "^[a-f0-9]{32}$" },
          },
        },
        signature: { type: "string", pattern: "^[A-Za-z0-9_-]{43}$" },
      },
    },
  },
} as const);

function readRecord(
  value: unknown,
  path: string,
  allowedKeys: readonly string[],
  context: ParseContext,
): DataRecord | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    addIssue(context, path, "INVALID_TYPE", "Expected an object.");
    return null;
  }

  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      addIssue(context, path, "UNSAFE_OBJECT", "Expected a plain data object.");
      return null;
    }

    const descriptors = Object.getOwnPropertyDescriptors(value);
    const ownKeys = Reflect.ownKeys(descriptors);
    if (ownKeys.length > allowedKeys.length + 64) {
      addIssue(context, path, "INPUT_TOO_LARGE", "The object contains too many fields.");
      return null;
    }
    if (ownKeys.some((key) => typeof key !== "string")) {
      addIssue(context, path, "UNSAFE_OBJECT", "Symbol properties are not accepted.");
      return null;
    }

    const record: DataRecord = Object.create(null) as DataRecord;
    for (const key of ownKeys as string[]) {
      const descriptor = descriptors[key];
      if (!descriptor || !("value" in descriptor)) {
        addIssue(context, path, "UNSAFE_OBJECT", "Accessor properties are not accepted.");
        return null;
      }
      if (!allowedKeys.includes(key)) {
        if (context.rejectUnknownFields) {
          addIssue(context, path, "UNKNOWN_FIELD", "The object contains an unknown field.");
        }
        continue;
      }
      record[key] = descriptor.value;
    }
    return record;
  } catch {
    addIssue(context, path, "UNSAFE_OBJECT", "The object could not be inspected safely.");
    return null;
  }
}

function requiredString(
  record: DataRecord,
  key: string,
  path: string,
  maximumLength: number,
  context: ParseContext,
  allowEmpty = false,
): string | null {
  if (!Object.hasOwn(record, key)) {
    addIssue(context, path, "MISSING_FIELD", "A required string field is missing.");
    return null;
  }
  const value = record[key];
  if (
    typeof value !== "string" ||
    value.length > maximumLength ||
    (!allowEmpty && value.trim().length === 0)
  ) {
    addIssue(context, path, "INVALID_VALUE", `Expected a string of at most ${maximumLength} characters.`);
    return null;
  }
  return value;
}

function optionalString(
  record: DataRecord,
  key: string,
  path: string,
  maximumLength: number,
  context: ParseContext,
): string | undefined {
  if (!Object.hasOwn(record, key)) return undefined;
  const value = record[key];
  if (typeof value !== "string" || value.trim().length === 0 || value.length > maximumLength) {
    addIssue(context, path, "INVALID_VALUE", `Expected a non-empty string of at most ${maximumLength} characters.`);
    return undefined;
  }
  return value;
}

function parseConsentRecord(value: unknown, path: string, context: ParseContext): ConsentRecord | null {
  const record = readRecord(value, path, ["status", "capturedAt", "source"], context);
  if (!record) return null;
  const status = record["status"];
  if (!(CONSENT_STATUSES as readonly unknown[]).includes(status)) {
    addIssue(context, `${path}.status`, "INVALID_VALUE", "Consent status is not supported.");
    return null;
  }
  const capturedAt = optionalString(record, "capturedAt", `${path}.capturedAt`, 64, context);
  const source = optionalString(record, "source", `${path}.source`, 256, context);
  return {
    status: status as ConsentRecord["status"],
    ...(capturedAt === undefined ? {} : { capturedAt }),
    ...(source === undefined ? {} : { source }),
  };
}

function parseConsent(value: unknown, context: ParseContext): CustomerContext["consent"] | null {
  const consent = readRecord(value, "$.customer.consent", CHANNELS, context);
  if (!consent) return null;

  const parsed: Partial<Record<Channel, Partial<Record<ContactPurpose, ConsentRecord>>>> = {};
  for (const channel of CHANNELS) {
    if (!Object.hasOwn(consent, channel)) continue;
    const purposes = readRecord(
      consent[channel],
      `$.customer.consent.${channel}`,
      PURPOSES,
      context,
    );
    if (!purposes) continue;
    const parsedPurposes: Partial<Record<ContactPurpose, ConsentRecord>> = {};
    for (const purpose of PURPOSES) {
      if (!Object.hasOwn(purposes, purpose)) continue;
      const consentRecord = parseConsentRecord(
        purposes[purpose],
        `$.customer.consent.${channel}.${purpose}`,
        context,
      );
      if (consentRecord) parsedPurposes[purpose] = consentRecord;
    }
    parsed[channel] = parsedPurposes;
  }
  return parsed;
}

function parseCustomer(value: unknown, context: ParseContext): CustomerContext | null {
  const record = readRecord(
    value,
    "$.customer",
    ["id", "timezone", "locale", "consent", "optedOutChannels"],
    context,
  );
  if (!record) return null;

  const id = requiredString(record, "id", "$.customer.id", 256, context);
  const timezone = requiredString(record, "timezone", "$.customer.timezone", 128, context);
  const locale = optionalString(record, "locale", "$.customer.locale", 64, context);
  const consent = Object.hasOwn(record, "consent")
    ? parseConsent(record["consent"], context)
    : (addIssue(context, "$.customer.consent", "MISSING_FIELD", "Consent context is required."), null);

  const rawOptOuts = record["optedOutChannels"];
  const optedOutChannels: Channel[] = [];
  if (!Object.hasOwn(record, "optedOutChannels")) {
    addIssue(context, "$.customer.optedOutChannels", "MISSING_FIELD", "Opt-out context is required.");
  } else if (!Array.isArray(rawOptOuts)) {
    addIssue(context, "$.customer.optedOutChannels", "INVALID_TYPE", "Expected an array.");
  } else if (rawOptOuts.length > CHANNELS.length) {
    addIssue(context, "$.customer.optedOutChannels", "INPUT_TOO_LARGE", "Too many opt-out entries.");
  } else {
    for (const channel of rawOptOuts) {
      if (!(CHANNELS as readonly unknown[]).includes(channel)) {
        addIssue(context, "$.customer.optedOutChannels[]", "INVALID_VALUE", "Opt-out channel is not supported.");
      } else if (!optedOutChannels.includes(channel as Channel)) {
        optedOutChannels.push(channel as Channel);
      }
    }
  }

  if (!id || !timezone || !consent) return null;
  return {
    id,
    timezone,
    ...(locale === undefined ? {} : { locale }),
    consent,
    optedOutChannels,
  };
}

function parseContactHistory(value: unknown, context: ParseContext): readonly ContactEvent[] | null {
  if (!Array.isArray(value)) {
    addIssue(context, "$.contactHistory", "INVALID_TYPE", "Expected an array.");
    return null;
  }
  if (value.length > context.maxContactHistoryLength) {
    addIssue(context, "$.contactHistory", "INPUT_TOO_LARGE", `Contact history exceeds ${context.maxContactHistoryLength} entries.`);
    return null;
  }

  const events: ContactEvent[] = [];
  for (const item of value) {
    const record = readRecord(item, "$.contactHistory[]", ["at", "channel", "purpose"], context);
    if (!record) continue;
    const at = requiredString(record, "at", "$.contactHistory[].at", 64, context);
    const channel = record["channel"];
    const purpose = record["purpose"];
    if (!(CHANNELS as readonly unknown[]).includes(channel)) {
      addIssue(context, "$.contactHistory[].channel", "INVALID_VALUE", "Contact channel is not supported.");
    }
    if (!(PURPOSES as readonly unknown[]).includes(purpose)) {
      addIssue(context, "$.contactHistory[].purpose", "INVALID_VALUE", "Contact purpose is not supported.");
    }
    if (at && (CHANNELS as readonly unknown[]).includes(channel) && (PURPOSES as readonly unknown[]).includes(purpose)) {
      events.push({ at, channel: channel as Channel, purpose: purpose as ContactPurpose });
    }
  }
  return events;
}

function parseOffer(value: unknown, context: ParseContext): CommercialOffer | null {
  const record = readRecord(value, "$.offer", ["discountPercent", "totalMinorUnits", "currency"], context);
  if (!record) return null;
  const offer: { discountPercent?: number; totalMinorUnits?: number; currency?: string } = {};
  const discountPercent = record["discountPercent"];
  if (Object.hasOwn(record, "discountPercent")) {
    if (typeof discountPercent !== "number" || !Number.isFinite(discountPercent) || discountPercent < 0 || discountPercent > 100) {
      addIssue(context, "$.offer.discountPercent", "INVALID_VALUE", "Discount must be between 0 and 100.");
    } else offer.discountPercent = discountPercent;
  }
  const totalMinorUnits = record["totalMinorUnits"];
  if (Object.hasOwn(record, "totalMinorUnits")) {
    if (typeof totalMinorUnits !== "number" || !Number.isSafeInteger(totalMinorUnits) || totalMinorUnits < 0) {
      addIssue(context, "$.offer.totalMinorUnits", "INVALID_VALUE", "Offer total must be a non-negative safe integer.");
    } else offer.totalMinorUnits = totalMinorUnits;
  }
  const currency = record["currency"];
  if (Object.hasOwn(record, "currency")) {
    if (typeof currency !== "string" || !/^[A-Z]{3}$/u.test(currency)) {
      addIssue(context, "$.offer.currency", "INVALID_VALUE", "Currency must be a three-letter uppercase code.");
    } else offer.currency = currency;
  }
  return offer;
}

function parseApproval(value: unknown, context: ParseContext): SignedApproval | null {
  const approval = readRecord(value, "$.approval", ["payload", "signature"], context);
  if (!approval) return null;
  const payload = readRecord(
    approval["payload"],
    "$.approval.payload",
    ["version", "actionFingerprint", "policyVersion", "ruleIds", "approvedBy", "approvedAt", "expiresAt", "nonce"],
    context,
  );
  if (!payload) return null;

  const version = payload["version"];
  const actionFingerprint = requiredString(payload, "actionFingerprint", "$.approval.payload.actionFingerprint", 64, context);
  const policyVersion = requiredString(payload, "policyVersion", "$.approval.payload.policyVersion", 128, context);
  const approvedBy = requiredString(payload, "approvedBy", "$.approval.payload.approvedBy", 256, context);
  const approvedAt = requiredString(payload, "approvedAt", "$.approval.payload.approvedAt", 64, context);
  const expiresAt = requiredString(payload, "expiresAt", "$.approval.payload.expiresAt", 64, context);
  const nonce = requiredString(payload, "nonce", "$.approval.payload.nonce", 32, context);
  const signature = requiredString(approval, "signature", "$.approval.signature", 128, context);
  if (version !== 1) addIssue(context, "$.approval.payload.version", "INVALID_VALUE", "Approval version is not supported.");

  const rawRuleIds = payload["ruleIds"];
  const ruleIds: string[] = [];
  if (!Array.isArray(rawRuleIds) || rawRuleIds.length === 0 || rawRuleIds.length > 64) {
    addIssue(context, "$.approval.payload.ruleIds", "INVALID_VALUE", "Approval rule IDs are malformed.");
  } else {
    for (const ruleId of rawRuleIds) {
      if (typeof ruleId !== "string" || !/^[A-Za-z0-9._:-]{1,128}$/u.test(ruleId)) {
        addIssue(context, "$.approval.payload.ruleIds[]", "INVALID_VALUE", "Approval rule ID is malformed.");
      } else ruleIds.push(ruleId);
    }
  }

  if (!actionFingerprint || !policyVersion || !approvedBy || !approvedAt || !expiresAt || !nonce || !signature || version !== 1) return null;
  const parsedPayload: ApprovalPayload = {
    version: 1,
    actionFingerprint,
    policyVersion,
    ruleIds,
    approvedBy,
    approvedAt,
    expiresAt,
    nonce,
  };
  return { payload: parsedPayload, signature };
}

export function parseSalesAction(
  input: unknown,
  options: ParseSalesActionOptions = {},
): SalesActionParseResult {
  const maxContentLength = options.maxContentLength ?? DEFAULT_MAX_CONTENT_LENGTH;
  const maxContactHistoryLength = options.maxContactHistoryLength ?? DEFAULT_MAX_CONTACT_HISTORY_LENGTH;
  if (!Number.isSafeInteger(maxContentLength) || maxContentLength <= 0) {
    throw new Error("Maximum content length must be a positive safe integer.");
  }
  if (!Number.isSafeInteger(maxContactHistoryLength) || maxContactHistoryLength <= 0) {
    throw new Error("Maximum contact history length must be a positive safe integer.");
  }

  const context: ParseContext = {
    issues: [],
    rejectUnknownFields: options.rejectUnknownFields ?? true,
    maxContentLength,
    maxContactHistoryLength,
  };

  try {
    const record = readRecord(
      input,
      "$",
      ["id", "customer", "channel", "purpose", "content", "scheduledAt", "contactHistory", "offer", "approval"],
      context,
    );
    if (!record) return { success: false, issues: context.issues };

    const id = requiredString(record, "id", "$.id", 256, context);
    const customer = Object.hasOwn(record, "customer")
      ? parseCustomer(record["customer"], context)
      : (addIssue(context, "$.customer", "MISSING_FIELD", "Customer context is required."), null);
    const channel = record["channel"];
    const purpose = record["purpose"];
    if (!(CHANNELS as readonly unknown[]).includes(channel)) addIssue(context, "$.channel", "INVALID_VALUE", "Contact channel is not supported.");
    if (!(PURPOSES as readonly unknown[]).includes(purpose)) addIssue(context, "$.purpose", "INVALID_VALUE", "Contact purpose is not supported.");
    const content = requiredString(record, "content", "$.content", maxContentLength, context, true);
    const scheduledAt = requiredString(record, "scheduledAt", "$.scheduledAt", 64, context);
    const contactHistory = Object.hasOwn(record, "contactHistory")
      ? parseContactHistory(record["contactHistory"], context)
      : (addIssue(context, "$.contactHistory", "MISSING_FIELD", "Contact history is required."), null);
    const offer = Object.hasOwn(record, "offer") ? parseOffer(record["offer"], context) : undefined;
    const approval = Object.hasOwn(record, "approval") ? parseApproval(record["approval"], context) : undefined;

    if (!id || !customer || !(CHANNELS as readonly unknown[]).includes(channel) || !(PURPOSES as readonly unknown[]).includes(purpose) || content === null || !scheduledAt || !contactHistory || (Object.hasOwn(record, "offer") && !offer) || (Object.hasOwn(record, "approval") && !approval)) {
      return { success: false, issues: context.issues };
    }

    const action: SalesAction = {
      id,
      customer,
      channel: channel as Channel,
      purpose: purpose as ContactPurpose,
      content,
      scheduledAt,
      contactHistory,
      ...(offer === undefined || offer === null ? {} : { offer }),
      ...(approval === undefined || approval === null ? {} : { approval }),
    };
    const validation = validateAction(action, maxContentLength, maxContactHistoryLength);
    if (validation) addIssue(context, "$", "INVALID_ACTION", validation.message);

    return context.issues.length === 0
      ? { success: true, value: action, issues: [] }
      : { success: false, issues: context.issues };
  } catch {
    addIssue(context, "$", "UNSAFE_OBJECT", "Input could not be parsed safely.");
    return { success: false, issues: context.issues };
  }
}

export function parseSalesActionJson(
  input: string,
  options: ParseSalesActionOptions = {},
): SalesActionParseResult {
  const maxJsonLength = options.maxJsonLength ?? 1_000_000;
  if (!Number.isSafeInteger(maxJsonLength) || maxJsonLength <= 0) {
    throw new Error("Maximum JSON length must be a positive safe integer.");
  }
  if (typeof input !== "string") {
    return {
      success: false,
      issues: [{ path: "$", code: "INVALID_TYPE", message: "Expected a JSON string." }],
    };
  }
  if (input.length > maxJsonLength) {
    return {
      success: false,
      issues: [{ path: "$", code: "INPUT_TOO_LARGE", message: "JSON input exceeds the configured limit." }],
    };
  }
  try {
    return parseSalesAction(JSON.parse(input) as unknown, options);
  } catch {
    return {
      success: false,
      issues: [{ path: "$", code: "INVALID_VALUE", message: "Input is not valid JSON." }],
    };
  }
}
