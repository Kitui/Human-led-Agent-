import { api, getAuthSession } from "../shared.js";

let registered = false;

export const ACTION_POINT_SUBMITTED_EVENT = "correlact:action-point-submitted";

function assertAuthorizedTenant(tenantId) {
  const session = getAuthSession();
  if (!session) throw new Error("Sign in to CorrelAct before submitting a Proposed Action.");
  if (!session.tenantIds.includes(tenantId)) {
    throw new Error(`You are not authorized for organization ${tenantId}.`);
  }
}

function notifyActionPointSubmitted(run, payload) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(ACTION_POINT_SUBMITTED_EVENT, {
    detail: { run, payload },
  }));
}

export async function submitActionPoint(payload) {
  const tenantId = String(payload?.tenant_id || "").trim();
  if (!tenantId) throw new Error("tenant_id is required.");
  assertAuthorizedTenant(tenantId);

  const run = await api("/webmcp/action-points", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  notifyActionPointSubmitted(run, payload);
  return run;
}

export async function registerActionPointWebMcpTool() {
  if (registered) return { supported: true, registered: true };
  if (!document.modelContext?.registerTool) {
    return { supported: false, registered: false };
  }

  await document.modelContext.registerTool({
    name: "submit_action_point",
    title: "Submit Proposed Action for human review",
    description: "Persist a Proposed Action after gathering evidence. This creates an awaiting-approval record only and does not execute any external action or CRM mutation. The proposal may bind one controlled execution capability: create_task, or update_crm_status. For CRM status updates the exact expected and target renewal statuses must be included so the human approves the precise transition before the write tool becomes usable.",
    inputSchema: {
      type: "object",
      properties: {
        tenant_id: {
          type: "string",
          description: "Authorized organization identifier, for example NorthStar.",
        },
        issue: {
          type: "string",
          description: "The operational issue being investigated.",
        },
        title: {
          type: "string",
          description: "Short Proposed Action title.",
        },
        issue_type: {
          type: "string",
          description: "Operational category, for example Billing and renewal.",
        },
        summary: {
          type: "string",
          description: "Evidence-grounded diagnosis of the issue.",
        },
        priority: {
          type: "string",
          enum: ["low", "medium", "high", "critical"],
        },
        recommended_action: {
          type: "string",
          description: "One focused approved action. Do not claim any external or CRM change has already been executed.",
        },
        confidence: {
          type: "number",
          minimum: 0,
          maximum: 1,
        },
        target_team: {
          type: "string",
          description: "Team that should own the approved action.",
        },
        execution: {
          type: "object",
          description: "Controlled write capability to bind to this proposal. Omit for legacy create_task behavior, or explicitly select the approved capability.",
          properties: {
            type: {
              type: "string",
              enum: ["create_task", "update_crm_status"],
            },
            crm_expected_status: {
              type: "string",
              enum: ["blocked", "normal"],
              description: "Required for update_crm_status. Current renewal_status shown by CRM evidence.",
            },
            crm_target_status: {
              type: "string",
              enum: ["escalation_open", "follow_up_required"],
              description: "Required for update_crm_status. Exact approved renewal_status after execution.",
            },
          },
          required: ["type"],
          additionalProperties: false,
        },
        evidence: {
          type: "array",
          minItems: 1,
          maxItems: 8,
          description: "Evidence references gathered from WebMCP tools.",
          items: {
            type: "object",
            properties: {
              source: {
                type: "string",
                enum: ["support", "crm", "billing"],
              },
              reference: {
                type: "string",
                description: "Source record identifier, for example CASE-ACME-8841 or INV-ACME-2026-08.",
              },
              finding: {
                type: "string",
                description: "Specific factual finding from that source.",
              },
            },
            required: ["source", "reference", "finding"],
            additionalProperties: false,
          },
        },
      },
      required: [
        "tenant_id",
        "issue",
        "title",
        "issue_type",
        "summary",
        "priority",
        "recommended_action",
        "confidence",
        "target_team",
        "evidence",
      ],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: false,
    },
    execute: async (input) => {
      const run = await submitActionPoint(input);
      return {
        source: "correlact",
        tool: "submit_action_point",
        persisted: true,
        run_id: run.run_id,
        status: run.status,
        human_approval_required: true,
        action_point: run.action_point,
      };
    },
  });

  registered = true;
  return { supported: true, registered: true };
}
