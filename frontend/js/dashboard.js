/* CorrelAct — Dashboard page.
 *
 * Dashboard state is derived from real workflow runs, persisted eval suites,
 * and the live API health endpoint. Readiness labels describe observed or
 * enforced capabilities rather than inventing per-service health checks.
 */
import {
  qs, escapeHtml, fmtTime, shortRunId, priorityBadge, statusBadge, titleCase,
  fmtDuration, STATUS_COLORS, cssVar, traceIconSvg, api, getAllKnownRuns,
  bindRunLinks, startOfDay,
} from "./shared.js";
import { openRunInInvestigate } from "./investigate.js";

const DASH_ICONS = {
  totalRuns: '<circle cx="12" cy="12" r="9"/><path d="M10 8.5v7l6-3.5-6-3.5Z"/>',
  pending: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="m17 11 2 2 4-4"/>',
  checkShield: '<path d="M12 3 5 6v5c0 4.5 3 8 7 9 4-1 7-4.5 7-9V6l-7-3Z"/><path d="m9.5 12 2 2 3.5-3.5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  mcp: '<path d="M9 2v6M15 2v6M9 22v-6M15 22v-6"/><rect x="6" y="8" width="12" height="8" rx="2"/>',
  guardrail: '<path d="M12 3 5 6v5c0 4.5 3 8 7 9 4-1 7-4.5 7-9V6l-7-3Z"/>',
  evals: '<path d="M4 20V10"/><path d="M11 20V4"/><path d="M18 20v-7"/>',
  api: '<path d="M6 8a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6"/><path d="M9.5 20a2.5 2.5 0 0 0 5 0"/>',
};

function computeDashboardStats(runs) {
  const total = runs.length;
  const pending = runs.filter((r) => (r.status || "").toLowerCase() === "awaiting_approval").length;

  const todayStart = startOfDay(Date.now());
  const yesterdayStart = todayStart - 86400000;
  const isCompleted = (r) => (r.status || "").toLowerCase() === "completed";
  const updatedAt = (r) => (r.updated_at ? new Date(r.updated_at).getTime() : null);

  const completedToday = runs.filter((r) => isCompleted(r) && updatedAt(r) >= todayStart).length;
  const completedYesterday = runs.filter(
    (r) => isCompleted(r) && updatedAt(r) >= yesterdayStart && updatedAt(r) < todayStart
  ).length;

  const durations = runs.map((r) => r.duration_seconds).filter((d) => typeof d === "number");
  const avgDuration = durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : null;

  const now = Date.now();
  const last7Start = now - 7 * 86400000;
  const prev7Start = now - 14 * 86400000;
  const createdAt = (r) => (r.created_at ? new Date(r.created_at).getTime() : null);
  const last7 = runs.filter((r) => createdAt(r) >= last7Start).length;
  const prev7 = runs.filter((r) => createdAt(r) >= prev7Start && createdAt(r) < last7Start).length;

  return { total, pending, completedToday, completedYesterday, avgDuration, durationsCount: durations.length, last7, prev7 };
}

function trendHtml(current, previous, label) {
  if (previous === 0 && current === 0) return `<span class="stat-trend flat">No data yet</span>`;
  if (previous === 0) return `<span class="stat-trend flat">No prior data to compare</span>`;
  const pct = ((current - previous) / previous) * 100;
  const dir = pct >= 0 ? "up" : "down";
  const arrow = pct >= 0 ? "↗" : "↘";
  return `<span class="stat-trend ${dir}">${arrow} ${Math.abs(pct).toFixed(1)}% ${label}</span>`;
}

function renderDashboardStats(runs, latestEval) {
  const s = computeDashboardStats(runs);
  const evalValue = latestEval ? `${latestEval.score.toFixed(0)}%` : "Ready";
  const evalDetail = latestEval
    ? `${latestEval.result === "passed" ? "Passed" : "Failed"} · ${latestEval.passed_count}/${latestEval.total_count} cases · ${latestEval.threshold.toFixed(0)}% gate`
    : "Run a live suite from Evals";
  const evalIconClass = latestEval?.result === "passed" ? "green" : "purple";

  qs("#dashboard-stats").innerHTML = `
    <div class="stat-card">
      <div class="stat-icon blue"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${DASH_ICONS.totalRuns}</svg></div>
      <div class="stat-body"><div class="stat-label">Total Runs</div><div class="stat-value">${s.total.toLocaleString()}</div>${trendHtml(s.last7, s.prev7, "vs prior 7 days")}</div>
    </div>
    <div class="stat-card">
      <div class="stat-icon orange"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${DASH_ICONS.pending}</svg></div>
      <div class="stat-body"><div class="stat-label">Pending Approvals</div><div class="stat-value">${s.pending}</div><span class="stat-trend flat">Live count</span></div>
    </div>
    <div class="stat-card">
      <div class="stat-icon green"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${DASH_ICONS.checkShield}</svg></div>
      <div class="stat-body"><div class="stat-label">Completed Today</div><div class="stat-value">${s.completedToday}</div>${trendHtml(s.completedToday, s.completedYesterday, "vs yesterday")}</div>
    </div>
    <div class="stat-card">
      <div class="stat-icon ${evalIconClass}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${DASH_ICONS.evals}</svg></div>
      <div class="stat-body"><div class="stat-label">Latest Evaluation</div><div class="stat-value">${evalValue}</div><span class="stat-trend flat">${escapeHtml(evalDetail)}</span></div>
    </div>
    <div class="stat-card">
      <div class="stat-icon blue"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${DASH_ICONS.clock}</svg></div>
      <div class="stat-body"><div class="stat-label">Avg Duration</div><div class="stat-value">${fmtDuration(s.avgDuration)}</div><span class="stat-trend flat">${s.durationsCount} run${s.durationsCount === 1 ? "" : "s"} measured</span></div>
    </div>
  `;
}

function bucketRunsByDay(runs, days) {
  const buckets = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    buckets.push({ time: d.getTime(), label: d.toLocaleDateString(undefined, { month: "short", day: "numeric" }), count: 0 });
  }
  runs.forEach((r) => {
    if (!r.created_at) return;
    const t = startOfDay(r.created_at);
    const bucket = buckets.find((b) => b.time === t);
    if (bucket) bucket.count++;
  });
  return buckets;
}

let volumeChartInstance = null;
let statusChartInstance = null;

function renderVolumeChart(runs) {
  const container = qs("#volume-chart");
  const buckets = bucketRunsByDay(runs, 7);

  if (volumeChartInstance) {
    volumeChartInstance.destroy();
    volumeChartInstance = null;
  }

  if (buckets.every((b) => b.count === 0)) {
    container.innerHTML = `<p class="empty-note">No runs in the last 7 days yet.</p>`;
    return;
  }

  container.innerHTML = `<canvas id="volume-canvas"></canvas>`;
  const ctx = qs("#volume-canvas", container).getContext("2d");

  const primary = cssVar("--primary", "#2563EB");
  const primaryBg = cssVar("--primary-bg", "#EFF6FF");
  const border = cssVar("--border", "#E5E7EB");
  const textFaint = cssVar("--text-faint", "#9CA3AF");

  volumeChartInstance = new Chart(ctx, {
    type: "line",
    data: {
      labels: buckets.map((b) => b.label),
      datasets: [{
        label: "Runs",
        data: buckets.map((b) => b.count),
        borderColor: primary,
        backgroundColor: primaryBg,
        fill: true,
        tension: 0.3,
        pointBackgroundColor: primary,
        pointBorderColor: cssVar("--surface", "#fff"),
        pointBorderWidth: 1.5,
        pointRadius: 4,
        pointHoverRadius: 5,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: (item) => `${item.parsed.y} run${item.parsed.y === 1 ? "" : "s"}` } },
      },
      scales: {
        x: { grid: { display: false }, ticks: { color: textFaint, font: { size: 11 } } },
        y: { beginAtZero: true, ticks: { precision: 0, color: textFaint, font: { size: 11 } }, grid: { color: border } },
      },
    },
  });
}

function renderStatusDonut(runs) {
  const container = qs("#status-donut");

  if (statusChartInstance) {
    statusChartInstance.destroy();
    statusChartInstance = null;
  }

  if (runs.length === 0) {
    container.innerHTML = `<p class="empty-note">No runs yet.</p>`;
    return;
  }

  const counts = {};
  runs.forEach((r) => {
    const s = (r.status || "unknown").toLowerCase();
    counts[s] = (counts[s] || 0) + 1;
  });
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const total = runs.length;

  container.innerHTML = `
    <div class="donut-wrap">
      <div class="donut-canvas-wrap"><canvas id="status-canvas"></canvas></div>
      <div class="donut-legend" id="donut-legend"></div>
    </div>
  `;

  qs("#donut-legend").innerHTML = entries.map(([status, count]) => `
    <div class="donut-legend-row">
      <span class="legend-name"><span class="dot" style="background:${STATUS_COLORS[status] || "#9CA3AF"}"></span>${escapeHtml(titleCase(status))}</span>
      <span class="legend-value">${count} (${((count / total) * 100).toFixed(1)}%)</span>
    </div>
  `).join("");

  const textColor = cssVar("--text", "#111827");
  const textFaint = cssVar("--text-faint", "#9CA3AF");
  const surface = cssVar("--surface", "#fff");
  const fontFamily = getComputedStyle(document.body).fontFamily;

  const centerTextPlugin = {
    id: "centerText",
    afterDraw(chart) {
      const { ctx, chartArea: { left, right, top, bottom } } = chart;
      const cx = (left + right) / 2;
      const cy = (top + bottom) / 2;
      ctx.save();
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = textColor;
      ctx.font = `700 20px ${fontFamily}`;
      ctx.fillText(String(total), cx, cy - 8);
      ctx.fillStyle = textFaint;
      ctx.font = `500 10.5px ${fontFamily}`;
      ctx.fillText("Total", cx, cy + 10);
      ctx.restore();
    },
  };

  statusChartInstance = new Chart(qs("#status-canvas").getContext("2d"), {
    type: "doughnut",
    data: {
      labels: entries.map(([s]) => titleCase(s)),
      datasets: [{
        data: entries.map(([, c]) => c),
        backgroundColor: entries.map(([s]) => STATUS_COLORS[s] || "#9CA3AF"),
        borderColor: surface,
        borderWidth: 2,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: "68%",
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: (item) => `${item.label}: ${item.parsed} (${((item.parsed / total) * 100).toFixed(1)}%)` } },
      },
    },
    plugins: [centerTextPlugin],
  });
}

function renderActivityList(runs) {
  const container = qs("#activity-list");
  const events = [];
  runs.forEach((r) => (r.trace || []).forEach((e) => events.push({ ...e, run_id: r.run_id })));
  events.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  const top = events.slice(0, 6);

  if (top.length === 0) {
    container.innerHTML = `<p class="empty-note">No activity yet. Investigate an issue to get started.</p>`;
    return;
  }

  const iconClassByKind = { guardrail: "purple", mcp: "blue", execution: "green", error: "red" };
  container.innerHTML = top.map((e) => `
    <div class="activity-row">
      <div class="activity-icon ${iconClassByKind[e.kind] || "blue"}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${traceIconSvg(e.kind)}</svg></div>
      <div class="activity-body"><div class="activity-title">${escapeHtml(e.label)}</div><div class="activity-sub">${escapeHtml(shortRunId(e.run_id))}${e.detail ? " — " + escapeHtml(e.detail.slice(0, 70)) : ""}</div></div>
      <div class="activity-time">${fmtTime(e.timestamp)}</div>
    </div>
  `).join("");
}

function latestTraceEvent(runs, predicate) {
  const events = [];
  runs.forEach((run) => (run.trace || []).forEach((event) => {
    if (predicate(event)) events.push(event);
  }));
  return events.sort((a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0))[0] || null;
}

async function renderHealthList(runs, latestEval) {
  const container = qs("#health-list");
  const cardTitle = container.closest(".card")?.querySelector("h2");
  if (cardTitle) cardTitle.textContent = "Operational Readiness";

  let apiHealthy = false;
  try {
    await api("/health");
    apiHealthy = true;
  } catch (_) {
    apiHealthy = false;
  }

  const mcpEvent = latestTraceEvent(runs, (event) => event.kind === "mcp");
  const guardrailEvent = latestTraceEvent(runs, (event) => event.kind === "guardrail");
  const evalPassed = latestEval?.result === "passed";

  const rows = [
    {
      title: "API Health",
      sub: apiHealthy ? "CorrelAct API is responding normally." : "The API did not respond to the latest health check.",
      badge: apiHealthy ? "healthy" : "down",
      badgeLabel: apiHealthy ? "Healthy" : "Unavailable",
      icon: DASH_ICONS.api,
    },
    {
      title: "MCP / Tool Activity",
      sub: mcpEvent ? `Tool activity verified ${fmtTime(mcpEvent.timestamp)}.` : "Agent tool runtime is configured; no recent tool event is in the visible run set.",
      badge: mcpEvent ? "healthy" : "unmonitored",
      badgeLabel: mcpEvent ? "Verified" : "Configured",
      icon: DASH_ICONS.mcp,
    },
    {
      title: "Guardrails",
      sub: guardrailEvent ? `Guardrail trace verified ${fmtTime(guardrailEvent.timestamp)}.` : "Guardrails are enforced for native investigation requests.",
      badge: "healthy",
      badgeLabel: guardrailEvent ? "Verified" : "Enforced",
      icon: DASH_ICONS.guardrail,
    },
    {
      title: "Evaluation Gate",
      sub: latestEval ? `${latestEval.score.toFixed(0)}% score across ${latestEval.total_count} cases; threshold ${latestEval.threshold.toFixed(0)}%.` : "The live evaluation suite is available from the Evals workspace.",
      badge: latestEval ? (evalPassed ? "healthy" : "down") : "unmonitored",
      badgeLabel: latestEval ? (evalPassed ? "Passed" : "Failed") : "Ready",
      icon: DASH_ICONS.evals,
    },
  ];

  container.innerHTML = rows.map((row) => `
    <div class="health-row">
      <div class="health-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${row.icon}</svg></div>
      <div class="health-body"><div class="health-title">${escapeHtml(row.title)}</div><div class="health-sub">${escapeHtml(row.sub)}</div></div>
      <span class="health-badge ${row.badge}"><span class="dot"></span>${escapeHtml(row.badgeLabel)}</span>
    </div>
  `).join("");
}

function dashboardRunsTableHtml(runs) {
  if (!runs || runs.length === 0) {
    return `<p class="empty-note">No runs yet. Investigate an issue to get started.</p>`;
  }
  const rows = runs.slice(0, 8).map((r) => `
    <tr>
      <td><a class="run-id-link" data-run-id="${escapeHtml(r.run_id)}">${escapeHtml(shortRunId(r.run_id))}</a></td>
      <td>${escapeHtml(r.tenant_id)}</td>
      <td>${statusBadge(r.status)}</td>
      <td>${r.action_point ? priorityBadge(r.action_point.priority) : "—"}</td>
      <td>${r.created_at ? fmtTime(r.created_at) : "—"}</td>
      <td>${fmtDuration(r.duration_seconds)}</td>
      <td>${r.updated_at ? fmtTime(r.updated_at) : "—"}</td>
      <td><button class="row-menu-btn" title="More">⋯</button></td>
    </tr>
  `).join("");
  return `
    <table>
      <thead><tr><th>Run ID</th><th>Organization</th><th>Status</th><th>Priority</th><th>Created At</th><th>Duration</th><th>Updated At</th><th></th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

async function getEvalRunsSafely() {
  try {
    const runs = await api("/evals/runs");
    return Array.isArray(runs) ? runs : [];
  } catch (_) {
    return [];
  }
}

export async function renderDashboardPage() {
  const [runs, evalRuns] = await Promise.all([
    getAllKnownRuns(),
    getEvalRunsSafely(),
  ]);
  const latestEval = evalRuns[0] || null;
  renderDashboardStats(runs, latestEval);
  renderVolumeChart(runs);
  renderStatusDonut(runs);
  renderActivityList(runs);
  await renderHealthList(runs, latestEval);
  const container = qs("#dashboard-runs-table");
  container.innerHTML = dashboardRunsTableHtml(runs);
  bindRunLinks(container, openRunInInvestigate);
}
