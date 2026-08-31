import { api, getAuthSession } from "../shared.js";

let registered = false;

function assertAuthorizedTenant(tenantId) {
  const session = getAuthSession();
  if (!session) throw new Error("Sign in to Correlact before submitting an Action Point.");
  if (!session.tenantIds.includes(tenantId)) {
    throw new Error(`You are not authorized for tenant ${tenantId}.`);
  }
}

export async function submitActionPoint(payload) {
  const tenantId = String(payload?.tenant_id || "").trim();
  if (!tenantId) throw new Error("tenant_id is required.");
  assertAuthorizedTenant(tenantId);

  return api("/webmcp/action-points", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function registerActionPointWebMcpTool() {
  if (registered) return { supported: true, registered: true };
  if (!document.modelContext?.registerTool) {
    return { supported: false, registered: false };
  }

  await document.modelContext.registerTool({
    name: "submit_action_point",
    title: "Submit Action Point for human review",
    description: "Persist a proposed Action Point in Correlact after gathering evidence. This creates an awaiting-approval record only; it does not execute any external action. Use one focused recommended action and cite the evidence that supports it.",
    inputSchema: {
      type: "object",
      properties: {
        tenant_id: {
          type: "string",
          description: "Authorized tenant workspace, for example tenant_red.",
        },
        issue: {
          type: "string",
          description: "The operational issue being investigated.",
        },
        title: {
          type: "string",
          description: "Short Action Point title.",
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
          description: "One focused next action for a human reviewer to approve or reject. Do not claim it has already been executed.",
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
