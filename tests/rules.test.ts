import assert from "node:assert/strict";
import test from "node:test";

import {
  createContactWindowRule,
  createFrequencyCapRule,
  createRestrictedClaimsRule,
  createSensitiveDataRule,
  GuardrailEngine,
} from "../src/index.js";
import { makeAction } from "./fixtures.js";

const NOW = new Date("2026-08-10T12:00:00.000Z");

test("blocks promotional contact outside the local window", async () => {
  const engine = new GuardrailEngine({
    rules: [
      createContactWindowRule({
        schedule: { mon: [{ start: "09:00", end: "18:00" }] },
      }),
    ],
    clock: () => NOW,
  });

  const evaluation = await engine.evaluate(makeAction({ scheduledAt: "2026-08-10T23:00:00.000Z" }));
  assert.equal(evaluation.decision, "block");
  assert.equal(evaluation.results[0]?.code, "OUTSIDE_CONTACT_WINDOW");
});

test("supports contact windows that cross midnight", async () => {
  const engine = new GuardrailEngine({
    rules: [
      createContactWindowRule({
        schedule: { mon: [{ start: "22:00", end: "02:00" }] },
      }),
    ],
    clock: () => NOW,
  });
  const action = makeAction({
    customer: { ...makeAction().customer, timezone: "UTC" },
    scheduledAt: "2026-08-11T01:30:00.000Z",
  });

  const evaluation = await engine.evaluate(action);
  assert.equal(evaluation.decision, "allow");
});

test("blocks when the frequency cap is reached", async () => {
  const engine = new GuardrailEngine({
    rules: [createFrequencyCapRule({ maximumContacts: 2, rollingWindowHours: 24 })],
    clock: () => NOW,
  });
  const action = makeAction({
    contactHistory: [
      { at: "2026-08-09T15:00:00.000Z", channel: "email", purpose: "marketing" },
      { at: "2026-08-10T11:00:00.000Z", channel: "sms", purpose: "sales_follow_up" },
    ],
  });

  const evaluation = await engine.evaluate(action);
  assert.equal(evaluation.decision, "block");
  assert.equal(evaluation.results[0]?.code, "FREQUENCY_CAP_REACHED");
});

test("fails closed on invalid contact history", async () => {
  const engine = new GuardrailEngine({
    rules: [createFrequencyCapRule({ maximumContacts: 3, rollingWindowHours: 24 })],
    clock: () => NOW,
  });
  const action = makeAction({
    contactHistory: [{ at: "not-a-date", channel: "email", purpose: "marketing" }],
  });

  const evaluation = await engine.evaluate(action);
  assert.equal(evaluation.decision, "block");
  assert.equal(evaluation.results[0]?.code, "INVALID_CONTACT_HISTORY");
});

test("blocks apparent credential exposure", async () => {
  const engine = new GuardrailEngine({ rules: [createSensitiveDataRule()], clock: () => NOW });
  const syntheticCredential = ["sk", "proj", "A".repeat(20)].join("-");
  const action = makeAction({
    content: `Nunca envie isto: ${syntheticCredential}`,
  });

  const evaluation = await engine.evaluate(action);
  assert.equal(evaluation.decision, "block");
  assert.equal(evaluation.results[0]?.code, "POSSIBLE_SECRET_EXPOSURE");
  assert.doesNotMatch(JSON.stringify(evaluation), new RegExp(syntheticCredential, "u"));
});

test("routes a valid CPF-shaped identifier to review without echoing it", async () => {
  const engine = new GuardrailEngine({ rules: [createSensitiveDataRule()], clock: () => NOW });
  const syntheticCpf = "111.444.777-35";
  const evaluation = await engine.evaluate(makeAction({ content: `Documento: ${syntheticCpf}` }));

  assert.equal(evaluation.decision, "review");
  assert.equal(evaluation.results[0]?.code, "SENSITIVE_DATA_REVIEW_REQUIRED");
  assert.doesNotMatch(JSON.stringify(evaluation), /111\.444/u);
});

test("routes guaranteed financial claims to review", async () => {
  const engine = new GuardrailEngine({ rules: [createRestrictedClaimsRule()], clock: () => NOW });
  const evaluation = await engine.evaluate(makeAction({ content: "Oferta com lucro garantido." }));

  assert.equal(evaluation.decision, "review");
  assert.equal(evaluation.results[0]?.code, "RESTRICTED_CLAIM_REVIEW_REQUIRED");
});
