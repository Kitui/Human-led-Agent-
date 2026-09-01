import { api, getAuthSession } from "../shared.js";

let registrationController = null;
let registeredTools = new Set();

export const TASK_EXECUTED_EVENT = "correlact:task-executed";

function assertAuthorizedTenant(tenantId) {
  const session = getAuthSession();
  if (!session) throw new Error("Sign in to CorrelAct before using controlled execution tools.");
  if (!session.tenantIds.includes(tenantId)) {
    throw new Error(`You are not authorized for organization ${tenantId}.`);
  }
}

function approvedExecutionType(run) {
  return run?.action_point?.execution?.type || "create_task";
}

async function executeApprovedAction(runId, tenantId, customerName, expectedType) {
  const run = String(runId || "").trim();
  const tenant = String(tenantId || "").trim();
  const customer = String(customerName || "").trim();
  if (!run) throw new Error("run_id is required.");
  if (!tenant) throw new Error("tenant_id is required.");
  if (!customer) throw new Error("customer_name is required.");

  assertAuthorizedTenant(tenant);

  // Keep the browser capability honest as well as the backend: a tool is only
  // allowed to submit a run whose human-approved execution type matches it.
  const approvedRun = await api(`/runs/${encodeURIComponent(run)}`);
  const actualType = approvedExecutionType(approvedRun);
  if (actualType !== expectedType) {
    throw new Error(`Approved run authorizes ${actualType}, not ${expectedType}.`);
  }
  if (approvedRun.tenant_id !== tenant) {
    throw new Error("Approved run does not belong to the selected organization.");
  }

  return api("/webmcp/tasks", {
    method: "POST",
    body: JSON.stringify({ run_id: run, tenant_id: tenant, customer_name: customer }),
  });
}

export async function executeApprovedTask(runId, tenantId, customerName) {
  return executeApprovedAction(runId, tenantId, customerName, "create_task");
}

export async function executeApprovedCrmStatus(runId, tenantId, customerName) {
  return executeApprovedAction(runId, tenantId, customerName, "update_crm_status");
}

function notifyTaskExecuted(result) {
  window.dispatchEvent(new CustomEvent(TASK_EXECUTED_EVENT, {
    detail: result,
  }));
}

function toolSignature(tools) {
  return [...new Set(tools)].sort().join("|");
}

export function isTaskWebMcpToolRegistered(toolName = null) {
  const active = !!registrationController && !registrationController.signal.aborted;
  if (!active) return false;
  return toolName ? registeredTools.has(toolName) : registeredTools.size > 0;
}

export function unregisterTaskWebMcpTool() {
  if (!registrationController) return false;
  registrationController.abort();
  registrationController = null;
  registeredTools = new Set();
  return true;
}

function commonInputSchema() {
  return {
    type: "object",
    properties: {
      run_id: {
        type: "string",
        description: "CorrelAct run ID whose exact Proposed Action has already been approved by a human.",
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
  };
}

async function registerCreateTask(controller) {
  await document.modelContext.registerTool({
    name: "create_task",
    title: "Create approved operational task",
    description: "Execute exactly one human-approved CorrelAct create_task action. The backend rejects unapproved, cross-organization, mismatched-customer, or differently-scoped runs. Priority, target team, customer, organization, and task content come from the approved Action Point and cannot be changed through this tool.",
    inputSchema: commonInputSchema(),
    annotations: { readOnlyHint: false },
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
}

async function registerCrmStatusUpdate(controller) {
  await document.modelContext.registerTool({
    name: "update_crm_status",
    title: "Apply approved CRM renewal-status update",
    description: "Execute exactly one human-approved CRM renewal-status transition. The tool accepts only the run, organization, and evidence-bound customer; the status change itself is frozen inside the approved Action Point. The backend rejects unapproved, cross-organization, stale-state, mismatched-customer, or differently-scoped runs and makes the write idempotent.",
    inputSchema: commonInputSchema(),
    annotations: { readOnlyHint: false },
    execute: async ({ run_id, tenant_id, customer_name }) => {
      const result = await executeApprovedCrmStatus(run_id, tenant_id, customer_name);
      notifyTaskExecuted(result);
      return {
        source: "crm",
        tool: "update_crm_status",
        run_id: result.run_id,
        status: result.status,
        execution_result: result.execution_result,
        idempotency_key: result.idempotency_key,
      };
    },
  }, { signal: controller.signal });
}

export async function registerTaskWebMcpTool(executionTypes = ["create_task"]) {
  const requested = [...new Set(executionTypes)].filter((name) =>
    ["create_task", "update_crm_status"].includes(name),
  );
  const requestedSignature = toolSignature(requested);
  const currentSignature = toolSignature(registeredTools);

  if (isTaskWebMcpToolRegistered() && requestedSignature === currentSignature) {
    return { supported: true, registered: true, registeredTools: [...registeredTools] };
  }
  if (!document.modelContext?.registerTool) {
    return { supported: false, registered: false, registeredTools: [] };
  }

  unregisterTaskWebMcpTool();
  if (!requested.length) {
    return { supported: true, registered: false, registeredTools: [] };
  }

  const controller = new AbortController();
  try {
    if (requested.includes("create_task")) await registerCreateTask(controller);
    if (requested.includes("update_crm_status")) await registerCrmStatusUpdate(controller);
  } catch (error) {
    controller.abort();
    throw error;
  }

  registrationController = controller;
  registeredTools = new Set(requested);
  return { supported: true, registered: true, registeredTools: [...registeredTools] };
}
