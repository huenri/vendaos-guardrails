import {
  createBrazilianPortuguesePolicy,
  GuardrailEngine,
} from "../dist/index.js";

const engine = new GuardrailEngine({
  policyVersion: "pt-BR-starter-2026-08",
  rules: createBrazilianPortuguesePolicy(),
});

const evaluation = await engine.evaluate({
  id: "action-demo-001",
  customer: {
    id: "customer-pseudonym-42",
    timezone: "America/Sao_Paulo",
    locale: "pt-BR",
    consent: {
      whatsapp: {
        marketing: {
          status: "granted",
          capturedAt: "2026-08-01T12:00:00.000Z",
          source: "consent-ledger",
        },
      },
    },
    optedOutChannels: [],
  },
  channel: "whatsapp",
  purpose: "marketing",
  content: "Olá! Temos uma condição especial. Responda SAIR para parar de receber.",
  scheduledAt: "2026-08-10T13:00:00.000Z",
  contactHistory: [],
  offer: { discountPercent: 10 },
});

console.log(JSON.stringify(evaluation, null, 2));

if (evaluation.decision !== "allow") {
  process.exitCode = 1;
}
