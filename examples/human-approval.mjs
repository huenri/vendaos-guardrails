import {
  createActionFingerprint,
  createBrazilianPortuguesePolicy,
  GuardrailEngine,
  issueApproval,
} from "../dist/index.js";

const approvalSecret = process.env.VENDAOS_APPROVAL_SECRET;
if (!approvalSecret) {
  throw new Error("Set VENDAOS_APPROVAL_SECRET to a server-only secret of at least 32 bytes.");
}

const proposedAction = {
  id: "action-demo-approval-001",
  customer: {
    id: "customer-pseudonym-42",
    timezone: "America/Sao_Paulo",
    consent: { whatsapp: { marketing: { status: "granted" } } },
    optedOutChannels: [],
  },
  channel: "whatsapp",
  purpose: "marketing",
  content: "Conseguimos oferecer 20% de desconto. Responda SAIR para parar de receber.",
  scheduledAt: "2026-08-10T13:00:00.000Z",
  contactHistory: [],
  offer: { discountPercent: 20 },
};

// The authenticated review service, not the sales agent, issues this token.
const approval = issueApproval(
  {
    actionFingerprint: createActionFingerprint(proposedAction),
    policyVersion: "pt-BR-starter-2026-08",
    ruleIds: ["commercial.discount-authority"],
    approvedBy: "authenticated-reviewer-id",
  },
  approvalSecret,
);

const engine = new GuardrailEngine({
  policyVersion: "pt-BR-starter-2026-08",
  rules: createBrazilianPortuguesePolicy(),
  approvalSecret,
});

console.log(await engine.evaluate({ ...proposedAction, approval }));
