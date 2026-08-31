import { api, getAuthSession } from "../shared.js";

let registered = false;

function assertAuthorizedTenant(tenantId) {
  const session = getAuthSession();
  if (!session) throw new Error("Sign in to Correlact before using Tasks tools.");
  if (!session.tenantIds.includes(tenantId)) {
    throw new Error(`You are not authorized for tenant ${tenantId}.`);
  }
}

export async function executeApprovedTask(runId, tenantId, customerName) {
  const run = String(runId || "").trim();
  const tenant = String(tenantId || "").trim();
  const customer = String(customerName || "").trim();
  if (!run) throw new Error("run_id is required.");
  if (!tenant) throw new Error("tenant_id is required.");
  if (!customer) throw new Error("customer_name is required.");

  assertAuthorizedTenant(tenant);
  return api("/webmcp/tasks", {
    method: "POST",
    body: JSON.stringify({ run_id: run, tenant_id: tenant, customer_name: customer }),
  });
}

export async function registerTaskWebMcpTool() {
  if (registered) return { supported: true, registered: true };
  if (!document.modelContext?.registerTool) {
    return { supported: false, registered: false };
  }

  await document.modelContext.registerTool({
    name: "create_task",
    title: "Create approved operational task",
    description: "Execute exactly one Correlact Action Point that has already been approved by a human. The backend rejects unapproved, rejected, cross-tenant, or mismatched-customer runs. The approved action, priority, and target team cannot be changed through this tool.",
    inputSchema: {
      type: "object",
      properties: {
        run_id: {
          type: "string",
          description: "Correlact run ID whose Action Point has already been approved by a human.",
        },
        tenant_id: {
          type: "string",
          description: "Authorized tenant workspace, for example tenant_red.",
        },
        customer_name: {
          type: "string",
          description: "Customer name tied to the approved run's CRM evidence, for example ACME.",
        },
      },
      required: ["run_id", "tenant_id", "customer_name"],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: false,
    },
    execute: async ({ run_id, tenant_id, customer_name }) => {
      const result = await executeApprovedTask(run_id, tenant_id, customer_name);
      return {
        source: "tasks",
        tool: "create_task",
        run_id: result.run_id,
        status: result.status,
        execution_result: result.execution_result,
        idempotency_key: result.idempotency_key,
      };
    },
  });

  registered = true;
  return { supported: true, registered: true };
}
