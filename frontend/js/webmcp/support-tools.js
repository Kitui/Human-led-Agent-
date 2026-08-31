import { getAuthSession } from "../shared.js";

let registered = false;

const REFERENCE_CASES = [
  {
    case_id: "CASE-ACME-8841",
    customer_name: "ACME",
    tenant_id: "NorthStar",
    channel: "email",
    priority: "high",
    status: "open",
    category: "billing_and_renewal",
    subject: "Invoice amount is wrong and renewal is blocked",
    customer_message: "ACME says the invoice amount is wrong and their renewal is blocked.",
    assigned_team: "Revenue Support",
    escalation_status: "escalated",
    opened_at: "2026-08-30T11:05:00Z",
    last_updated: "2026-08-30T14:35:00Z",
  },
  {
    case_id: "CASE-GREENMART-2190",
    customer_name: "GreenMart",
    tenant_id: "Neptune",
    channel: "web",
    priority: "low",
    status: "resolved",
    category: "general_account",
    subject: "Confirm renewal schedule",
    customer_message: "GreenMart asked to confirm the upcoming renewal schedule.",
    assigned_team: "Customer Success",
    escalation_status: "none",
    opened_at: "2026-08-27T08:10:00Z",
    last_updated: "2026-08-27T10:20:00Z",
  },
];

function normalizeCustomerName(value) {
  return String(value || "").trim().toUpperCase();
}

function assertAuthorizedTenant(tenantId) {
  const session = getAuthSession();
  if (!session) throw new Error("Sign in to CorrelAct before using Support tools.");
  if (!session.tenantIds.includes(tenantId)) {
    throw new Error(`You are not authorized for organization ${tenantId}.`);
  }
}

export async function fetchCase(customerName, tenantId) {
  const name = normalizeCustomerName(customerName);
  const tenant = String(tenantId || "").trim();
  if (!name) throw new Error("customer_name is required.");
  if (!tenant) throw new Error("tenant_id is required.");

  assertAuthorizedTenant(tenant);

  const supportCase = REFERENCE_CASES.find(
    (item) => item.tenant_id === tenant && normalizeCustomerName(item.customer_name) === name,
  );

  if (supportCase) {
    return { found: true, case: { ...supportCase } };
  }

  const existsElsewhere = REFERENCE_CASES.some(
    (item) => normalizeCustomerName(item.customer_name) === name,
  );
  if (existsElsewhere) {
    throw new Error("Support case is not available in this organization.");
  }

  return { found: false, error: "NOT_FOUND" };
}

export async function registerSupportWebMcpTools() {
  if (registered) return { supported: true, registered: true };
  if (!document.modelContext?.registerTool) {
    return { supported: false, registered: false };
  }

  await document.modelContext.registerTool({
    name: "get_case",
    title: "Get customer support case",
    description: "Read the current customer support case for an authorized organization. Use this to verify the customer-reported issue, case priority, status, category, escalation state, and assigned team before correlating evidence from CRM and Billing.",
    inputSchema: {
      type: "object",
      properties: {
        customer_name: {
          type: "string",
          description: "Customer or account name, for example ACME.",
        },
        tenant_id: {
          type: "string",
          description: "Authorized organization identifier, for example NorthStar.",
        },
      },
      required: ["customer_name", "tenant_id"],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: true,
    },
    execute: async ({ customer_name, tenant_id }) => {
      const result = await fetchCase(customer_name, tenant_id);
      return {
        source: "support",
        tool: "get_case",
        ...result,
      };
    },
  });

  registered = true;
  return { supported: true, registered: true };
}
