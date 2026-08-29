/* Human-Led Agent Lab — Evals page
 *
 * Every number here comes from actually running agent_lab/eval_cases.py's
 * real cases against the live investigator agent via POST /evals/run (see
 * agent_lab/evals_runner.py) — nothing is simulated. The page starts empty
 * until you click "Run Evals"; run history is persisted in PostgreSQL.
 *
 * Don't confuse the two different "category"-shaped things here:
 *  - Each eval case has a real topic label (EvalCaseResult.category, e.g.
 *    "Security Guardrails", "Tenant Controls" -- see eval_cases.py). The
 *    "Number of Test Cases" stat counts how many distinct labels appear in
 *    the latest run.
 *  - The "Pass / Fail by Judgment Check" chart below always has exactly
 *    three rows -- it checks three specific, hardcoded judgment skills
 *    every case is scored on regardless of its topic label: did the agent
 *    pick the right priority, the right approval decision, and (where
 *    applicable) call its tool correctly. It's deliberately named
 *    "Judgment Check" rather than "Category" to avoid exactly the
 *    confusion the old shared name caused.
 */
import {
  qs, escapeHtml, fmtTime, deltaFromYesterdayHtml, cssVar, api, showBanner,
  showConfirmModal,
} from "./shared.js";

let evalsChartInstance = null;
let categoryChartInstance = null;

async function fetchEvalRuns() {
  try {
    return await api("/evals/runs");
  } catch (_) {
    return [];
  }
}

function evalResultBadge(result) {
  const cls = result === "passed" ? "eval-badge-passed" : "eval-badge-failed";
  return `<span class="badge ${cls}">${result === "passed" ? "PASSED" : "FAILED"}</span>`;
}

function computeCategoryStats(runs) {
  const cats = {
    "Priority Classification": { pass: 0, fail: 0 },
    "Approval Behavior": { pass: 0, fail: 0 },
    "Tool Use": { pass: 0, fail: 0 },
  };
  runs.forEach((run) => {
    run.cases.forEach((c) => {
      if (c.error) return; // request itself failed — not a classification signal either way
      if (c.actual_priority === c.expected_priority) cats["Priority Classification"].pass++;
      else cats["Priority Classification"].fail++;
      if (c.actual_approval === c.expected_approval) cats["Approval Behavior"].pass++;
      else cats["Approval Behavior"].fail++;
      // Only cases that actually named a customer test this dimension —
      // tool_call_correct is null (not applicable) for the rest.
      if (c.tool_call_correct === true) cats["Tool Use"].pass++;
      else if (c.tool_call_correct === false) cats["Tool Use"].fail++;
    });
  });
  return cats;
}

function computeRegressions(runs) {
  // runs[0] is most recent (API returns newest-first). A regression is a
  // case that passed last time but fails this time.
  if (runs.length < 2) return [];
  const latest = runs[0], previous = runs[1];
  const prevByName = Object.fromEntries(previous.cases.map((c) => [c.name, c]));
  return latest.cases.filter((c) => !c.passed && prevByName[c.name] && prevByName[c.name].passed);
}

function countRealCategories(run) {
  if (!run) return 0;
  return new Set(run.cases.map((c) => c.category)).size;
}

function renderEvalsStats(runs) {
  const latest = runs[0] || null;
  const previous = runs[1] || null;
  const regressions = computeRegressions(runs);
  const categoryCount = countRealCategories(latest);

  const scoreTrend = latest && previous
    ? deltaFromYesterdayHtml(latest.score, previous.score, (n) => `${n.toFixed(1)} pts`).replace("from yesterday", "vs last run")
    : `<span class="stat-trend flat">${runs.length ? "No prior run to compare" : "Not run yet"}</span>`;

  qs("#evals-stats").innerHTML = `
    <div class="stat-card">
      <div class="stat-icon blue"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20V10"/><path d="M18 20V4"/><path d="M6 20v-4"/></svg></div>
      <div class="stat-body">
        <div class="stat-label">Overall Score</div>
        <div class="stat-value">${latest ? `${latest.score.toFixed(0)}%` : "—"}</div>
        ${scoreTrend}
      </div>
    </div>
    <div class="stat-card">
      <div class="stat-icon green"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 5 6v5c0 4.5 3 8 7 9 4-1 7-4.5 7-9V6l-7-3Z"/><path d="m9.5 12 2 2 3.5-3.5"/></svg></div>
      <div class="stat-body">
        <div class="stat-label">Quality Gate Threshold</div>
        <div class="stat-value">${latest ? `${latest.threshold.toFixed(0)}%` : "90%"}</div>
        <span class="stat-trend flat">Defined in evals/eval_cases.py</span>
      </div>
    </div>
    <div class="stat-card">
      <div class="stat-icon ${latest ? (latest.result === "passed" ? "green" : "") : "blue"}" ${latest && latest.result !== "passed" ? 'style="background:var(--danger-bg);color:var(--danger);"' : ""}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${latest && latest.result !== "passed" ? '<circle cx="12" cy="12" r="9"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/>' : '<path d="M20 6 9 17l-5-5"/>'}</svg>
      </div>
      <div class="stat-body">
        <div class="stat-label">Latest Suite Result</div>
        <div class="stat-value" style="font-size:19px;">${latest ? (latest.result === "passed" ? "Passed" : "Failed") : "Not run yet"}</div>
        <span class="stat-trend flat">${latest ? `${latest.passed_count}/${latest.total_count} cases` : "Click Run Evals to start"}</span>
      </div>
    </div>
    <div class="stat-card">
      <div class="stat-icon purple"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18"/></svg></div>
      <div class="stat-body">
        <div class="stat-label">Number of Test Cases</div>
        <div class="stat-value">${latest ? latest.total_count : "—"}</div>
        <span class="stat-trend flat">${latest ? `${categoryCount} categor${categoryCount === 1 ? "y" : "ies"}` : "Not run yet"}</span>
      </div>
    </div>
    <div class="stat-card">
      <div class="stat-icon" style="background:${regressions.length ? "var(--danger-bg)" : "var(--success-bg)"};color:${regressions.length ? "var(--danger)" : "var(--success)"};">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>
      </div>
      <div class="stat-body">
        <div class="stat-label">Regression Alerts</div>
        <div class="stat-value">${regressions.length}</div>
        <span class="stat-trend flat">${regressions.length ? "Needs attention" : (runs.length < 2 ? "Need 2+ runs to detect" : "None")}</span>
      </div>
    </div>
  `;
}

function renderEvalsScoreChart(runs) {
  const container = qs("#evals-score-chart");
  if (evalsChartInstance) { evalsChartInstance.destroy(); evalsChartInstance = null; }

  if (runs.length === 0) {
    container.innerHTML = `<p class="empty-note">No eval runs yet — click "Run Evals" to run the suite.</p>`;
    return;
  }

  const chronological = runs.slice().reverse(); // oldest first for the chart
  container.innerHTML = `<canvas id="evals-score-canvas"></canvas>`;

  const primary = cssVar("--primary", "#2563EB");
  const primaryBg = cssVar("--primary-bg", "#EFF6FF");
  const border = cssVar("--border", "#E5E7EB");
  const textFaint = cssVar("--text-faint", "#9CA3AF");
  const danger = cssVar("--danger", "#DC2626");

  evalsChartInstance = new Chart(qs("#evals-score-canvas").getContext("2d"), {
    type: "line",
    data: {
      labels: chronological.map((r) => fmtTime(r.started_at)),
      datasets: [
        {
          label: "Score",
          data: chronological.map((r) => r.score),
          borderColor: primary,
          backgroundColor: primaryBg,
          fill: true,
          tension: 0.3,
          pointBackgroundColor: primary,
          pointRadius: 4,
        },
        {
          label: "Threshold",
          data: chronological.map((r) => r.threshold),
          borderColor: danger,
          borderDash: [6, 4],
          pointRadius: 0,
          fill: false,
          tension: 0,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: true, position: "top", labels: { boxWidth: 12, font: { size: 11 } } } },
      scales: {
        x: { grid: { display: false }, ticks: { color: textFaint, font: { size: 10.5 } } },
        y: { min: 0, max: 100, ticks: { color: textFaint, font: { size: 11 }, callback: (v) => `${v}%` }, grid: { color: border } },
      },
    },
  });
}

function renderCategoryBreakdown(runs) {
  const container = qs("#evals-category-breakdown");
  if (categoryChartInstance) { categoryChartInstance.destroy(); categoryChartInstance = null; }

  if (runs.length === 0) {
    container.innerHTML = `<p class="empty-note">No eval runs yet.</p>`;
    return;
  }
  const cats = computeCategoryStats(runs);
  const names = Object.keys(cats);
  const totals = names.map((name) => cats[name].pass + cats[name].fail);
  const passPct = names.map((name, i) => (totals[i] ? (cats[name].pass / totals[i]) * 100 : 0));
  const failPct = names.map((name, i) => (totals[i] ? (cats[name].fail / totals[i]) * 100 : 0));

  let totalPass = 0, totalFail = 0;
  names.forEach((name) => { totalPass += cats[name].pass; totalFail += cats[name].fail; });
  const grandTotal = totalPass + totalFail;
  const grandPct = grandTotal ? ((totalPass / grandTotal) * 100).toFixed(0) : "0";

  container.innerHTML = `
    <div class="chart-container" style="height:180px;"><canvas id="evals-category-canvas"></canvas></div>
    <div class="category-bar-total-row">
      <span>Total</span>
      <span>${grandPct}% (${totalPass} / ${grandTotal})</span>
    </div>
  `;

  const success = cssVar("--success", "#16A34A");
  const danger = cssVar("--danger", "#DC2626");
  const textFaint = cssVar("--text-faint", "#9CA3AF");

  categoryChartInstance = new Chart(qs("#evals-category-canvas").getContext("2d"), {
    type: "bar",
    data: {
      labels: names,
      datasets: [
        {
          label: "Pass",
          data: passPct,
          backgroundColor: success,
          counts: names.map((name) => cats[name].pass),
        },
        {
          label: "Fail",
          data: failPct,
          backgroundColor: danger,
          counts: names.map((name) => cats[name].fail),
        },
      ],
    },
    options: {
      indexAxis: "y",
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: { stacked: true, min: 0, max: 100, ticks: { color: textFaint, font: { size: 11 }, callback: (v) => `${v}%` } },
        y: { stacked: true, ticks: { color: textFaint, font: { size: 11.5 } } },
      },
      plugins: {
        legend: { display: true, position: "top", labels: { boxWidth: 12, font: { size: 11 } } },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const count = ctx.dataset.counts[ctx.dataIndex];
              const total = totals[ctx.dataIndex];
              return `${ctx.dataset.label}: ${ctx.parsed.x.toFixed(0)}% (${count}/${total})`;
            },
          },
        },
      },
    },
  });
}

function renderEvalsSuitesTable(runs) {
  const container = qs("#evals-suites-table");
  if (runs.length === 0) {
    container.innerHTML = `<p class="empty-note">No eval runs yet.</p>`;
    return;
  }
  const rows = runs.map((r) => {
    const pct = r.total_count ? (r.passed_count / r.total_count) * 100 : 0;
    const barClass = r.result === "passed" ? "" : (pct >= 50 ? "warn" : "fail");
    return `
      <tr>
        <td class="eval-suite-row-name">Eval Suite</td>
        <td>${r.total_count}</td>
        <td>
          <div class="eval-pass-rate-cell">
            <div class="eval-pass-rate-bar"><div class="eval-pass-rate-bar-fill ${barClass}" style="width:${pct}%;"></div></div>
            <span>${(r.score / 100).toFixed(2)}</span>
          </div>
        </td>
        <td>${(r.threshold / 100).toFixed(2)}</td>
        <td>${evalResultBadge(r.result)}</td>
        <td>${fmtTime(r.started_at)}</td>
      </tr>
    `;
  }).join("");

  container.innerHTML = `
    <div class="table-scroll">
      <table>
        <thead><tr><th>Suite</th><th>Cases</th><th>Pass Rate</th><th>Threshold</th><th>Result</th><th>Run Time</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

function renderFailedCases(runs) {
  const container = qs("#evals-failed-cases");
  if (runs.length === 0) {
    container.innerHTML = `<p class="empty-note">No eval runs yet.</p>`;
    return;
  }
  const latest = runs[0];
  const regressionNames = new Set(computeRegressions(runs).map((c) => c.name));
  const failed = latest.cases.filter((c) => !c.passed);

  if (failed.length === 0) {
    container.innerHTML = `<p class="empty-note">All cases passed in the latest run.</p>`;
    return;
  }

  container.innerHTML = failed.map((c) => {
    const mismatches = [];
    if (c.actual_priority !== c.expected_priority) mismatches.push("Priority Classification");
    if (c.actual_approval !== c.expected_approval) mismatches.push("Approval Behavior");
    if (c.tool_call_correct === false) mismatches.push("Tool Use");
    return `
      <div class="failed-case-row">
        <div class="failed-case-head">
          <div>
            <div class="failed-case-title"><span class="dot"></span>${escapeHtml(c.name)}${regressionNames.has(c.name) ? ' <span class="badge eval-badge-warn" style="margin-left:6px;">REGRESSION</span>' : ""}</div>
            <div class="failed-case-meta">
              ${mismatches.map(escapeHtml).join(" • ") || "Request error"}
              ${c.error ? ` — ${escapeHtml(c.error.slice(0, 80))}` : ""}
            </div>
          </div>
          <span class="badge eval-badge-failed">FAIL</span>
        </div>
      </div>
    `;
  }).join("");
}

async function triggerEvalRun() {
  const btn = qs("#evals-run-btn");
  const confirmed = await showConfirmModal(
    "This sends 3 real requests to the live investigator agent (real OpenAI API usage, ~20-40s).",
    { title: "Run the eval suite?", okLabel: "Run Evals", cancelLabel: "Cancel" }
  );
  if (!confirmed) return;

  btn.disabled = true;
  const originalHtml = btn.innerHTML;
  btn.innerHTML = "<span>Running…</span>";

  try {
    await api("/evals/run", { method: "POST" });
    await renderEvalsPage();
  } catch (err) {
    showBanner(`Eval run failed: ${err.message}`);
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalHtml;
  }
}

export async function renderEvalsPage() {
  const runs = await fetchEvalRuns(); // newest first

  renderEvalsStats(runs);
  renderEvalsScoreChart(runs);
  renderCategoryBreakdown(runs);
  renderEvalsSuitesTable(runs);
  renderFailedCases(runs);

  qs("#evals-run-btn").onclick = triggerEvalRun;
  qs("#evals-view-all-runs").onclick = (e) => {
    e.preventDefault();
    qs("#evals-suites-table").scrollIntoView({ behavior: "smooth", block: "center" });
  };
}
