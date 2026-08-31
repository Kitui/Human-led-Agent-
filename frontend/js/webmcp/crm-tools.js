import { api, getAuthSession } from "../shared.js";

let registered = false;

function assertAuthorizedTenant(tenantId) {
  const session = getAuthSession();
  if (!session) throw new Error("Sign in to CorrelAct before using CRM tools.");
  if (!session.tenantIds.includes(tenantId)) {
    throw new Error(`You are not authorized for organization ${tenantId}.`);
  }
}

export async function fetchCustomer(customerName, tenantId, signal) {
  const name = String(customerName || "").trim();
  const tenant = String(tenantId || "").trim();
  if (!name) throw new Error("customer_name is required.");
  if (!tenant) throw new Error("tenant_id is required.");

  assertAuthorizedTenant(tenant);
  const path = `/crm/customers/${encodeURIComponent(name)}?tenant_id=${encodeURIComponent(tenant)}`;
  return api(path, signal ? { signal } : undefined);
}

export async function registerCrmWebMcpTools() {
  if (registered) return { supported: true, registered: true };
  if (!document.modelContext?.registerTool) {
    return { supported: false, registered: false };
  }

  await document.modelContext.registerTool({
    name: "get_customer",
    title: "Get customer account",
    description: "Read a customer account from the CRM workspace for an authorized organization. Use this to check plan, account, billing, and renewal status before making an operational recommendation.",
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
    execute: async ({ customer_name, tenant_id }, client = {}) => {
      const result = await fetchCustomer(customer_name, tenant_id, client.signal);
      return {
        source: "crm",
        tool: "get_customer",
        ...result,
      };
    },
  });

  registered = true;
  return { supported: true, registered: true };
}
