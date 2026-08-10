import type { SalesAction } from "../src/index.js";

export function makeAction(overrides: Partial<SalesAction> = {}): SalesAction {
  return {
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
            source: "test-fixture",
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
    ...overrides,
  };
}
