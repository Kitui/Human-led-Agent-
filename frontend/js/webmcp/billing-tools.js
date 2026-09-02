import { getAuthSession } from "../shared.js";

let registered = false;

/* Billing has no backend route or database table (unlike CRM, which is real
 * and PostgreSQL-backed, and whose renewal_status is the one piece of state
 * WebMCP's controlled-execution tools are allowed to mutate). This dataset
 * is a deliberately static evidence source representing a third external
 * system for the agent to correlate against -- not a stubbed-out real
 * integration. Do not read its lack of persistence as a bug. */
const REFERENCE_INVOICES = [
  {
    invoice_id: "INV-ACME-2026-08",
    customer_name: "ACME",
    tenant_id: "NorthStar",
    currency: "USD",
    contract_amount: 120000,
    billed_amount: 126000,
    variance_amount: 6000,
    invoice_status: "disputed",
    dispute_status: "open",
    dispute_reason: "Renewal uplift was applied before the signed amendment was completed.",
    renewal_hold: true,
    due_date: "2026-09-15",
    last_updated: "2026-08-30T14:20:00Z",
  },
  {
    invoice_id: "INV-GREENMART-2026-08",
    customer_name: "GreenMart",
    tenant_id: "Neptune",
    currency: "USD",
    contract_amount: 25000,
    billed_amount: 25000,
    variance_amount: 0,
    invoice_status: "clear",
    dispute_status: "none",
    dispute_reason: null,
    renewal_hold: false,
    due_date: "2026-09-20",
    last_updated: "2026-08-29T09:10:00Z",
  },
];

function normalizeCustomerName(value) {
  return String(value || "").trim().toUpperCase();
}

function assertAuthorizedTenant(tenantId) {
  const session = getAuthSession();
  if (!session) throw new Error("Sign in to CorrelAct before using Billing tools.");
  if (!session.tenantIds.includes(tenantId)) {
    throw new Error(`You are not authorized for organization ${tenantId}.`);
  }
}

export async function fetchInvoice(customerName, tenantId) {
  const name = normalizeCustomerName(customerName);
  const tenant = String(tenantId || "").trim();
  if (!name) throw new Error("customer_name is required.");
  if (!tenant) throw new Error("tenant_id is required.");

  assertAuthorizedTenant(tenant);

  const invoice = REFERENCE_INVOICES.find(
    (item) => item.tenant_id === tenant && normalizeCustomerName(item.customer_name) === name,
  );

  if (invoice) {
    return { found: true, invoice: { ...invoice } };
  }

  const existsElsewhere = REFERENCE_INVOICES.some(
    (item) => normalizeCustomerName(item.customer_name) === name,
  );
  if (existsElsewhere) {
    throw new Error("Invoice is not available in this organization.");
  }

  return { found: false, error: "NOT_FOUND" };
}

export async function registerBillingWebMcpTools() {
  if (registered) return { supported: true, registered: true };
  if (!document.modelContext?.registerTool) {
    return { supported: false, registered: false };
  }

  await document.modelContext.registerTool({
    name: "get_invoice",
    title: "Get customer invoice",
    description: "Read the current customer invoice from the Billing workspace for an authorized organization. Use this to verify billed amount, contract amount, dispute state, variance, and whether billing is holding renewal.",
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
      const result = await fetchInvoice(customer_name, tenant_id);
      return {
        source: "billing",
        tool: "get_invoice",
        ...result,
      };
    },
  });

  registered = true;
  return { supported: true, registered: true };
}
