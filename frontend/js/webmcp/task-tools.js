import { api, getAuthSession } from "../shared.js";

let registrationController = null;

export const TASK_EXECUTED_EVENT = "correlact:task-executed";

function assertAuthorizedTenant(tenantId) {
  const session = getAuthSession();
  if (!session) throw new Error("Sign in to CorrelAct before using Tasks tools.");
  if (!session.tenantIds.includes(tenantId)) {
    throw new Error(`You are not authorized for organization ${tenantId}.`);
  }
}

function notifyTaskExecuted(result) {
  window.dispatchEvent(new CustomEvent(TASK_EXECUTED_EVENT, {
    detail: result,
  }));
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

export function isTaskWebMcpToolRegistered() {
  return !!registrationController && !registrationController.signal.aborted;
}

export function unregisterTaskWebMcpTool() {
  if (!registrationController) return false;
  registrationController.abort();
  registrationController = null;
  return true;
}

export async function registerTaskWebMcpTool() {
  if (isTaskWebMcpToolRegistered()) return { supported: true, registered: true };
  if (!document.modelContext?.registerTool) {
    return { supported: false, registered: false };
  }

  const controller = new AbortController();

  try {
    await document.modelContext.registerTool({
      name: "create_task",
      title: "Create approved operational task",
      description: "Execute exactly one CorrelAct Proposed Action that has already been approved by a human. The backend rejects unapproved, rejected, cross-organization, or mismatched-customer runs. The approved action, priority, target team, organization, and customer scope cannot be changed through this tool.",
      inputSchema: {
        type: "object",
        properties: {
          run_id: {
            type: "string",
            description: "CorrelAct run ID whose Proposed Action has already been approved by a human.",
          },
          tenant_id: {
            type: "string",
            description: "Authorized organization identifier, for example NorthStar.",
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
        notifyTaskExecuted(result);
        return {
          source: "tasks",
          tool: "create_task",
          run_id: result.run_id,
          status: result.status,
          execution_result: result.execution_result,
          idempotency_key: result.idempotency_key,
        };
      },
    }, { signal: controller.signal });
  } catch (error) {
    controller.abort();
    throw error;
  }

  registrationController = controller;
  return { supported: true, registered: true };
}
