import BpmnModeler from "bpmn-js/lib/Modeler";
import BpmnViewer from "bpmn-js/lib/NavigatedViewer";
import {
  BpmnPropertiesPanelModule,
  BpmnPropertiesProviderModule,
  ZeebePropertiesProviderModule,
} from "bpmn-js-properties-panel";
import zeebeModdle from "zeebe-bpmn-moddle/resources/zeebe.json";

import "bpmn-js/dist/assets/diagram-js.css";
import "bpmn-js/dist/assets/bpmn-js.css";
import "bpmn-js/dist/assets/bpmn-font/css/bpmn-embedded.css";
import "@bpmn-io/properties-panel/dist/assets/properties-panel.css";

import { DEFAULT_DIAGRAM } from "./default-diagram";
import * as api from "./api";

// ── Constants ──────────────────────────────────────────────
const BASE_PATH = "/modeler";

// ── Status bar ──────────────────────────────────────────────
const statusMessage = document.getElementById("status-message")!;
function setStatus(msg: string, kind: "info" | "success" | "error" = "info") {
  statusMessage.textContent = msg;
  statusMessage.className = kind === "info" ? "" : `status-${kind}`;
}

// ── Router ─────────────────────────────────────────────────
// URL scheme:
//   /modeler/                      → Home (root folder)
//   /modeler/folders/:id           → Home (specific folder)
//   /modeler/projects/:id          → Modeler (diagram editor)
//   /modeler/instances             → Instances list
//   /modeler/instances/:id         → Instance detail
//   /modeler/user-tasks            → User tasks list
//   /modeler/incidents             → Incidents list

interface Route {
  view: string;
  folderId?: string;
  projectId?: string;
  instanceId?: string;
}

function parseRoute(pathname: string): Route {
  // Strip base path and trailing slash
  let path = pathname;
  if (path.startsWith(BASE_PATH)) path = path.slice(BASE_PATH.length);
  if (path.startsWith("/")) path = path.slice(1);
  if (path.endsWith("/")) path = path.slice(0, -1);

  if (!path || path === "") return { view: "home" };

  const segments = path.split("/");

  if (segments[0] === "folders" && segments[1]) {
    return { view: "home", folderId: segments[1] };
  }
  if (segments[0] === "projects" && segments[1]) {
    return { view: "modeler", projectId: segments[1] };
  }
  if (segments[0] === "instances" && segments[1]) {
    return { view: "instance-detail", instanceId: segments[1] };
  }
  if (segments[0] === "instances") return { view: "instances" };
  if (segments[0] === "user-tasks") return { view: "user-tasks" };
  if (segments[0] === "incidents") return { view: "incidents" };

  return { view: "home" };
}

function buildPath(route: Route): string {
  switch (route.view) {
    case "home":
      return route.folderId ? `${BASE_PATH}/folders/${route.folderId}` : `${BASE_PATH}/`;
    case "modeler":
      return `${BASE_PATH}/projects/${route.projectId}`;
    case "instances":
      return `${BASE_PATH}/instances`;
    case "instance-detail":
      return `${BASE_PATH}/instances/${route.instanceId}`;
    case "user-tasks":
      return `${BASE_PATH}/user-tasks`;
    case "incidents":
      return `${BASE_PATH}/incidents`;
    default:
      return `${BASE_PATH}/`;
  }
}

/** Navigate to a route, pushing browser history */
function navigate(route: Route, replace = false) {
  const path = buildPath(route);
  if (replace) {
    history.replaceState(route, "", path);
  } else {
    history.pushState(route, "", path);
  }
  applyRoute(route);
}

/** Apply a route without changing browser history */
function applyRoute(route: Route) {
  // Update tab highlights
  const tabName = route.view === "modeler" || route.view === "instance-detail" ? null : route.view;
  tabs.forEach((t) => t.classList.toggle("active", t.dataset.tab === tabName));
  views.forEach((v) => v.classList.toggle("active", v.id === `view-${route.view}`));

  switch (route.view) {
    case "home":
      currentFolderId = route.folderId ?? null;
      refreshHome();
      break;
    case "modeler":
      if (route.projectId) openProject(route.projectId, false);
      break;
    case "instances":
      refreshInstances();
      break;
    case "instance-detail":
      if (route.instanceId) openInstanceDetail(route.instanceId, false);
      break;
    case "user-tasks":
      refreshUserTasks();
      break;
    case "incidents":
      refreshIncidents();
      break;
  }
}

// Handle browser back/forward
window.addEventListener("popstate", (e) => {
  const route = e.state as Route | null;
  if (route) {
    applyRoute(route);
  } else {
    applyRoute(parseRoute(location.pathname));
  }
});

// ── Tab navigation ──────────────────────────────────────────
const tabs = document.querySelectorAll<HTMLButtonElement>(".tab");
const views = document.querySelectorAll<HTMLElement>(".view");

tabs.forEach((t) =>
  t.addEventListener("click", () => {
    const tab = t.dataset.tab!;
    navigate({ view: tab });
  }),
);

// ── Home / Project Browser ─────────────────────────────────
let currentFolderId: string | null = null;
let currentProjectId: string | null = null;

const homeTbody = document.getElementById("home-tbody")!;
const homeEmpty = document.getElementById("home-empty")!;
const breadcrumbsNav = document.getElementById("breadcrumbs")!;

async function refreshHome() {
  try {
    const result = await api.browse(currentFolderId);
    homeTbody.innerHTML = "";
    const hasItems = result.folders.length > 0 || result.projects.length > 0;
    homeEmpty.style.display = hasItems ? "none" : "block";

    // Breadcrumbs
    breadcrumbsNav.innerHTML = result.breadcrumbs
      .map((b, i) => {
        const isLast = i === result.breadcrumbs.length - 1;
        if (isLast) return `<span class="current">${escHtml(b.name)}</span>`;
        return `<a data-nav-folder="${b.id ?? ""}">${escHtml(b.name)}</a><span class="separator">›</span>`;
      })
      .join("");

    breadcrumbsNav.querySelectorAll("[data-nav-folder]").forEach((a) =>
      a.addEventListener("click", () => {
        const fid = (a as HTMLElement).dataset.navFolder;
        const folderId = fid || undefined;
        navigate({ view: "home", folderId });
      }),
    );

    // Folders
    for (const folder of result.folders) {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td><span class="item-icon item-icon-folder">📁</span></td>
        <td><span class="home-item-name" data-open-folder="${folder.id}">${escHtml(folder.name)}</span></td>
        <td>${fmtDate(folder.updated_at)}</td>
        <td><button class="btn-small btn-danger" data-delete-folder="${folder.id}" title="Delete folder">✕</button></td>
      `;
      homeTbody.appendChild(tr);
    }

    // Projects
    for (const project of result.projects) {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td><span class="item-icon item-icon-project">⚙</span></td>
        <td>
          <span class="home-item-name" data-open-project="${project.id}">${escHtml(project.name)}</span>
          ${project.description ? `<div style="font-size:11px;color:#888;">${escHtml(project.description)}</div>` : ""}
        </td>
        <td>${fmtDate(project.updated_at)}</td>
        <td><button class="btn-small btn-danger" data-delete-project="${project.id}" title="Delete">✕</button></td>
      `;
      homeTbody.appendChild(tr);
    }

    // Bind events
    homeTbody.querySelectorAll("[data-open-folder]").forEach((el) =>
      el.addEventListener("click", () => {
        const folderId = (el as HTMLElement).dataset.openFolder!;
        navigate({ view: "home", folderId });
      }),
    );

    homeTbody.querySelectorAll("[data-open-project]").forEach((el) =>
      el.addEventListener("click", () => {
        const projectId = (el as HTMLElement).dataset.openProject!;
        navigate({ view: "modeler", projectId });
      }),
    );

    homeTbody.querySelectorAll("[data-delete-folder]").forEach((btn) =>
      btn.addEventListener("click", async () => {
        const id = (btn as HTMLElement).dataset.deleteFolder!;
        if (!confirm("Delete this folder and all its contents?")) return;
        await api.deleteFolder(id);
        refreshHome();
      }),
    );

    homeTbody.querySelectorAll("[data-delete-project]").forEach((btn) =>
      btn.addEventListener("click", async () => {
        const id = (btn as HTMLElement).dataset.deleteProject!;
        if (!confirm("Delete this diagram?")) return;
        await api.deleteProject(id);
        refreshHome();
      }),
    );

    setStatus(`${result.folders.length} folder(s), ${result.projects.length} diagram(s)`, "success");
  } catch (err) {
    setStatus(`Failed to load: ${err instanceof Error ? err.message : err}`, "error");
  }
}

document.getElementById("btn-new-folder")!.addEventListener("click", async () => {
  const name = prompt("Folder name:");
  if (!name) return;
  try {
    await api.createFolder(name, currentFolderId);
    refreshHome();
  } catch (err) {
    setStatus(`Failed: ${err instanceof Error ? err.message : err}`, "error");
  }
});

async function handleNewProject() {
  const name = prompt("Diagram name:");
  if (!name) return;
  try {
    const project = await api.createProject(name, currentFolderId);
    navigate({ view: "modeler", projectId: project.id });
  } catch (err) {
    setStatus(`Failed: ${err instanceof Error ? err.message : err}`, "error");
  }
}

document.getElementById("btn-new-project")!.addEventListener("click", handleNewProject);
document.getElementById("btn-new-project-empty")!.addEventListener("click", handleNewProject);

async function openProject(projectId: string, pushHistory = true) {
  try {
    const project = await api.getProject(projectId);
    currentProjectId = project.id;
    document.getElementById("project-title")!.textContent = project.name;

    // Show modeler view
    tabs.forEach((t) => t.classList.remove("active"));
    views.forEach((v) => v.classList.toggle("active", v.id === "view-modeler"));

    if (pushHistory) {
      const route: Route = { view: "modeler", projectId };
      history.pushState(route, "", buildPath(route));
    }

    await openDiagram(project.bpmn_xml);
    setStatus(`Opened "${project.name}"`, "success");
  } catch (err) {
    setStatus(`Failed to open project: ${err instanceof Error ? err.message : err}`, "error");
  }
}

// ── Modeler view ────────────────────────────────────────────
const modeler = new BpmnModeler({
  container: "#canvas",
  propertiesPanel: { parent: "#properties-panel" },
  additionalModules: [
    BpmnPropertiesPanelModule,
    BpmnPropertiesProviderModule,
    ZeebePropertiesProviderModule,
  ],
  moddleExtensions: { zeebe: zeebeModdle },
});

async function openDiagram(xml: string) {
  try {
    await modeler.importXML(xml);
    (modeler.get("canvas") as any).zoom("fit-viewport");
    setStatus("Diagram loaded", "success");
  } catch (err) {
    setStatus(`Failed to load diagram: ${err}`, "error");
  }
}

document.getElementById("file-input")!.addEventListener("change", (e) => {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    const xml = ev.target?.result as string;
    if (xml) openDiagram(xml);
  };
  reader.readAsText(file);
  (e.target as HTMLInputElement).value = "";
});

document.getElementById("btn-export")!.addEventListener("click", async () => {
  try {
    const { xml } = await modeler.saveXML({ format: true });
    if (!xml) return;
    const blob = new Blob([xml], { type: "application/xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "process.bpmn";
    a.click();
    URL.revokeObjectURL(url);
    setStatus("Diagram exported", "success");
  } catch (err) {
    setStatus(`Export failed: ${err}`, "error");
  }
});

document.getElementById("btn-deploy")!.addEventListener("click", async () => {
  try {
    const { xml } = await modeler.saveXML({ format: true });
    if (!xml) { setStatus("No diagram to deploy", "error"); return; }
    setStatus("Deploying...");
    const result = await api.deployDefinition(xml);
    setStatus(
      `Deployed "${result.key}" v${result.version} (${result.id.slice(0, 8)})`,
      "success",
    );
  } catch (err) {
    setStatus(`Deploy failed: ${err instanceof Error ? err.message : err}`, "error");
  }
});

document.getElementById("btn-save")!.addEventListener("click", async () => {
  if (!currentProjectId) {
    setStatus("No project open — use Home to create one first", "error");
    return;
  }
  try {
    const { xml } = await modeler.saveXML({ format: true });
    if (!xml) { setStatus("No diagram to save", "error"); return; }
    await api.saveProject(currentProjectId, { bpmnXml: xml });
    setStatus("Saved", "success");
  } catch (err) {
    setStatus(`Save failed: ${err instanceof Error ? err.message : err}`, "error");
  }
});

document.getElementById("btn-back-home")!.addEventListener("click", () => {
  navigate({ view: "home", folderId: currentFolderId ?? undefined });
});

// ── Modal ──────────────────────────────────────────────────
const modal = document.getElementById("user-task-modal")!;
const modalTitle = document.getElementById("modal-title")!;
const modalBody = document.getElementById("modal-body")!;

document.getElementById("modal-close")!.addEventListener("click", closeModal);
modal.addEventListener("click", (e) => {
  if (e.target === modal) closeModal();
});

function closeModal() {
  modal.style.display = "none";
  modalBody.innerHTML = "";
}

// ── Instances view ──────────────────────────────────────────
const instancesTbody = document.getElementById("instances-tbody")!;
const instancesEmpty = document.getElementById("instances-empty")!;
const instanceStateFilter = document.getElementById("instance-state-filter") as HTMLSelectElement;

async function refreshInstances() {
  try {
    const state = instanceStateFilter.value || undefined;
    const instances = await api.listInstances({ state });
    instancesTbody.innerHTML = "";
    instancesEmpty.style.display = instances.length ? "none" : "block";

    for (const inst of instances) {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td class="mono">${inst.id.slice(0, 8)}</td>
        <td>${inst.definition_key}</td>
        <td>v${inst.definition_version}</td>
        <td>${badge(inst.state)}</td>
        <td>${fmtDate(inst.created_at)}</td>
        <td>${fmtDate(inst.updated_at)}</td>
        <td><button class="btn-small" data-view-instance="${inst.id}">View</button></td>
      `;
      instancesTbody.appendChild(tr);
    }

    instancesTbody.querySelectorAll("[data-view-instance]").forEach((btn) =>
      btn.addEventListener("click", () => {
        const instanceId = (btn as HTMLElement).dataset.viewInstance!;
        navigate({ view: "instance-detail", instanceId });
      }),
    );

    setStatus(`${instances.length} instance(s) loaded`, "success");
  } catch (err) {
    setStatus(`Failed to load instances: ${err instanceof Error ? err.message : err}`, "error");
  }
}

document.getElementById("btn-refresh-instances")!.addEventListener("click", refreshInstances);
instanceStateFilter.addEventListener("change", refreshInstances);

document.getElementById("btn-start-instance")!.addEventListener("click", async () => {
  try {
    const defs = await api.listDefinitions();
    if (defs.length === 0) {
      setStatus("No deployed definitions. Deploy a process first.", "error");
      return;
    }
    showStartInstanceModal(defs);
  } catch (err) {
    setStatus(`Failed to load definitions: ${err instanceof Error ? err.message : err}`, "error");
  }
});

function showStartInstanceModal(defs: api.DefinitionInfo[]) {
  modalTitle.textContent = "Start Instance";
  const options = defs.map(
    (d) => `<option value="${escHtml(d.key)}">${escHtml(d.key)} (v${d.version})</option>`,
  ).join("");
  modalBody.innerHTML = `
    <div class="modal-body-content">
      <label for="start-process-key">Process</label>
      <select id="start-process-key">${options}</select>
      <label for="start-variables">Variables (JSON, optional)</label>
      <textarea id="start-variables" placeholder='{"orderId": "ORD-001"}'></textarea>
    </div>
    <div class="modal-actions">
      <button id="modal-cancel-btn">Cancel</button>
      <button id="modal-confirm-btn" class="btn-primary">Start</button>
    </div>
  `;
  modal.style.display = "flex";

  document.getElementById("modal-cancel-btn")!.addEventListener("click", closeModal);
  document.getElementById("modal-confirm-btn")!.addEventListener("click", async () => {
    const processKey = (document.getElementById("start-process-key") as HTMLSelectElement).value;
    const raw = (document.getElementById("start-variables") as HTMLTextAreaElement).value.trim();
    let variables: Record<string, unknown> = {};
    if (raw) {
      try {
        variables = JSON.parse(raw);
      } catch {
        setStatus("Invalid JSON in variables", "error");
        return;
      }
    }
    try {
      const result = await api.createInstance(processKey, variables);
      setStatus(`Instance ${result.id.slice(0, 8)} started`, "success");
      closeModal();
      refreshInstances();
    } catch (err) {
      setStatus(`Start failed: ${err instanceof Error ? err.message : err}`, "error");
    }
  });
}

// ── Instance detail view ────────────────────────────────────
let detailViewer: InstanceType<typeof BpmnViewer> | null = null;
let currentInstanceId: string | null = null;

async function openInstanceDetail(instanceId: string, pushHistory = true) {
  currentInstanceId = instanceId;

  views.forEach((v) => v.classList.remove("active"));
  document.getElementById("view-instance-detail")!.classList.add("active");
  tabs.forEach((t) => t.classList.remove("active"));

  if (pushHistory) {
    const route: Route = { view: "instance-detail", instanceId };
    history.pushState(route, "", buildPath(route));
  }

  await loadInstanceDetail(instanceId);
}

async function loadInstanceDetail(instanceId: string) {
  try {
    const snapshot = await api.getInstance(instanceId);
    const def = await api.getDefinition(snapshot.definitionId);

    // ── Metadata header ──
    const stateIcon = document.getElementById("detail-state-icon")!;
    if (snapshot.state === "completed") {
      stateIcon.textContent = "✅";
    } else if (snapshot.state === "active") {
      stateIcon.textContent = "🔵";
    } else if (snapshot.state === "terminated") {
      stateIcon.textContent = "🔴";
    } else {
      stateIcon.textContent = "⚪";
    }

    document.getElementById("meta-process-name")!.textContent = snapshot.definitionKey;
    document.getElementById("meta-instance-key")!.textContent = snapshot.id.slice(0, 16);
    document.getElementById("meta-version")!.textContent = String(snapshot.definitionVersion);
    document.getElementById("meta-start-date")!.textContent =
      snapshot.createdAt ? fmtDateFull(snapshot.createdAt) : "—";
    document.getElementById("meta-end-date")!.textContent =
      snapshot.endedAt ? fmtDateFull(snapshot.endedAt) : "—";

    // ── Render BPMN viewer ──
    if (detailViewer) {
      detailViewer.destroy();
    }
    detailViewer = new BpmnViewer({
      container: "#detail-canvas",
      moddleExtensions: { zeebe: zeebeModdle },
    });
    await detailViewer.importXML(def.bpmn_xml);
    (detailViewer.get("canvas") as any).zoom("fit-viewport");

    const canvas = detailViewer.get("canvas") as any;
    const overlays = detailViewer.get("overlays") as any;
    const elementRegistry = detailViewer.get("elementRegistry") as any;

    // Build set of visited element IDs
    const completedElementIds = new Set(
      snapshot.tokens.filter((t) => t.state === "completed").map((t) => t.element_id),
    );
    const activeElementIds = new Set(
      snapshot.tokens
        .filter((t) => t.state === "active" || t.state === "waiting" || t.state === "incident")
        .map((t) => t.element_id),
    );

    // Color completed elements blue
    for (const elId of completedElementIds) {
      try { canvas.addMarker(elId, "completed-element"); } catch { /* ignore */ }
    }

    // Color active elements with thick blue border
    for (const elId of activeElementIds) {
      try { canvas.addMarker(elId, "active-element"); } catch { /* ignore */ }
    }

    // Color sequence flows that connect visited elements
    const allVisited = new Set([...completedElementIds, ...activeElementIds]);
    const allElements = elementRegistry.getAll();
    for (const el of allElements) {
      if (el.type === "bpmn:SequenceFlow" && el.source && el.target) {
        if (allVisited.has(el.source.id) && allVisited.has(el.target.id)) {
          try { canvas.addMarker(el.id, "completed-flow"); } catch { /* ignore */ }
        }
      }
    }

    // Token count overlays on active elements
    for (const elId of activeElementIds) {
      try {
        overlays.add(elId, {
          position: { bottom: -8, right: -8 },
          html: `<div class="token-overlay token-active" style="width:24px;height:24px;font-size:10px;">●</div>`,
        });
      } catch { /* ignore */ }
    }

    // Completed count overlay on end events
    for (const elId of completedElementIds) {
      const el = elementRegistry.get(elId);
      if (el && el.type === "bpmn:EndEvent") {
        const count = snapshot.tokens.filter(
          (t) => t.element_id === elId && t.state === "completed",
        ).length;
        try {
          overlays.add(elId, {
            position: { bottom: -10, right: -10 },
            html: `<div class="token-overlay" style="background:#4a9eff;font-size:10px;padding:0 6px;">✓ ${count}</div>`,
          });
        } catch { /* ignore */ }
      }
    }

    // ── Instance History tree ──
    renderHistoryTree(snapshot);

    // ── Variables panel ──
    renderVariablesPanel(snapshot);

    setStatus(`Instance ${instanceId.slice(0, 8)} loaded`, "success");
  } catch (err) {
    setStatus(`Failed to load instance: ${err instanceof Error ? err.message : err}`, "error");
  }
}

function getElementIcon(elementType: string | null): string {
  switch (elementType) {
    case "startEvent": return "○";
    case "endEvent": return "◉";
    case "serviceTask": return "☐";
    case "userTask": return "☐";
    case "exclusiveGateway": return "◇";
    case "parallelGateway": return "◇";
    case "intermediateCatchEvent": return "⏱";
    default: return "•";
  }
}

function getTokenState(elementId: string, tokens: api.TokenInfo[]): string {
  const token = tokens.find((t) => t.element_id === elementId);
  if (!token) return "completed";
  return token.state;
}

function renderHistoryTree(snap: api.InstanceSnapshot) {
  const tree = document.getElementById("detail-history-tree")!;

  const orderedElements: { elementId: string; elementType: string; name: string; state: string }[] = [];
  const seen = new Set<string>();

  const sortedAudit = [...(snap.audit ?? [])].sort(
    (a, b) => new Date(a.occurred_at).getTime() - new Date(b.occurred_at).getTime(),
  );

  for (const evt of sortedAudit) {
    if (!evt.element_id || seen.has(evt.element_id)) continue;
    if (evt.event_type === "TOKEN_CREATED" || evt.event_type === "TOKEN_COMPLETED") {
      seen.add(evt.element_id);
      const tokenState = getTokenState(evt.element_id, snap.tokens);
      orderedElements.push({
        elementId: evt.element_id,
        elementType: evt.element_type ?? "unknown",
        name: evt.element_id,
        state: tokenState,
      });
    }
  }

  const rootState = snap.state === "completed" ? "completed" : snap.state === "active" ? "active" : "incident";
  let html = `
    <div class="history-item">
      <span class="history-icon history-icon-${rootState}">${rootState === "completed" ? "✓" : "●"}</span>
      <span class="history-name" style="font-weight:600;">${snap.definitionKey}</span>
    </div>
  `;

  for (const el of orderedElements) {
    const iconClass = el.state === "completed" ? "completed" : el.state === "active" || el.state === "waiting" ? "active" : "incident";
    const icon = el.state === "completed" ? "✓" : "●";
    html += `
      <div class="history-item history-item-indent">
        <span class="history-icon history-icon-${iconClass}">${icon}</span>
        <span style="font-size:14px;margin-right:2px;">${getElementIcon(el.elementType)}</span>
        <span class="history-name">${escHtml(el.name)}</span>
      </div>
    `;
  }

  tree.innerHTML = html;
}

function renderVariablesPanel(snap: api.InstanceSnapshot) {
  const panel = document.getElementById("detail-variables-content")!;
  const entries = Object.entries(snap.variables ?? {});

  if (entries.length === 0) {
    panel.innerHTML = `<div style="padding:20px;text-align:center;color:rgba(255,255,255,0.4);font-size:13px;">The Flow Node has no Variables</div>`;
    return;
  }

  let html = `<table class="var-table"><thead><tr><th>Name</th><th>Value</th></tr></thead><tbody>`;
  for (const [key, value] of entries) {
    html += `<tr>
      <td>${escHtml(key)}</td>
      <td class="var-value">${escHtml(JSON.stringify(value))}</td>
    </tr>`;
  }
  html += `</tbody></table>`;
  panel.innerHTML = html;
}

document.getElementById("btn-back-instances")!.addEventListener("click", () => {
  navigate({ view: "instances" });
});

document.getElementById("btn-refresh-detail")!.addEventListener("click", () => {
  if (currentInstanceId) loadInstanceDetail(currentInstanceId);
});

// ── Incidents view ──────────────────────────────────────────
const incidentsTbody = document.getElementById("incidents-tbody")!;
const incidentsEmpty = document.getElementById("incidents-empty")!;

async function refreshIncidents() {
  try {
    const incidents = await api.listIncidents({ activeOnly: true });
    incidentsTbody.innerHTML = "";
    incidentsEmpty.style.display = incidents.length ? "none" : "block";

    for (const inc of incidents) {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td class="mono">${inc.id.slice(0, 8)}</td>
        <td><button class="btn-small" data-view-inc-instance="${inc.instance_id}">${inc.instance_id.slice(0, 8)}</button></td>
        <td>${inc.type}</td>
        <td title="${escHtml(inc.error_message)}">${truncate(inc.error_message, 50)}</td>
        <td>${badge(inc.state)}</td>
        <td>${fmtDate(inc.created_at)}</td>
        <td>${inc.state === "active" ? `<button class="btn-small btn-danger" data-resolve="${inc.id}">Resolve</button>` : ""}</td>
      `;
      incidentsTbody.appendChild(tr);
    }

    incidentsTbody.querySelectorAll("[data-resolve]").forEach((btn) =>
      btn.addEventListener("click", async () => {
        const id = (btn as HTMLElement).dataset.resolve!;
        try {
          await api.resolveIncident(id);
          setStatus(`Incident ${id.slice(0, 8)} resolved`, "success");
          refreshIncidents();
        } catch (err) {
          setStatus(`Resolve failed: ${err instanceof Error ? err.message : err}`, "error");
        }
      }),
    );

    incidentsTbody.querySelectorAll("[data-view-inc-instance]").forEach((btn) =>
      btn.addEventListener("click", () => {
        const instanceId = (btn as HTMLElement).dataset.viewIncInstance!;
        navigate({ view: "instance-detail", instanceId });
      }),
    );

    setStatus(`${incidents.length} incident(s) loaded`, "success");
  } catch (err) {
    setStatus(`Failed to load incidents: ${err instanceof Error ? err.message : err}`, "error");
  }
}

document.getElementById("btn-refresh-incidents")!.addEventListener("click", refreshIncidents);

// ── User Tasks view ────────────────────────────────────────
const userTasksTbody = document.getElementById("user-tasks-tbody")!;
const userTasksEmpty = document.getElementById("user-tasks-empty")!;
const userTaskStateFilter = document.getElementById("user-task-state-filter") as HTMLSelectElement;

async function refreshUserTasks() {
  try {
    const state = userTaskStateFilter.value || undefined;
    const tasks = await api.listUserTasks({ state });
    userTasksTbody.innerHTML = "";
    userTasksEmpty.style.display = tasks.length ? "none" : "block";

    for (const task of tasks) {
      const tr = document.createElement("tr");
      const actions = buildTaskActions(task);
      tr.innerHTML = `
        <td class="mono">${task.id.slice(0, 8)}</td>
        <td><button class="btn-small" data-view-ut-instance="${task.instance_id}">${task.instance_id.slice(0, 8)}</button></td>
        <td class="mono">${task.element_id}</td>
        <td>${task.task_name ?? "-"}</td>
        <td>${task.assignee ?? "-"}</td>
        <td>${badge(task.state)}</td>
        <td>${fmtDate(task.created_at)}</td>
        <td><div class="action-group">${actions}</div></td>
      `;
      userTasksTbody.appendChild(tr);
    }

    bindUserTaskActions();
    setStatus(`${tasks.length} user task(s) loaded`, "success");
  } catch (err) {
    setStatus(`Failed to load user tasks: ${err instanceof Error ? err.message : err}`, "error");
  }
}

function buildTaskActions(task: api.UserTaskInfo): string {
  if (task.state === "created") {
    return `
      <button class="btn-small" data-claim-task="${task.id}">Claim</button>
      <button class="btn-small btn-success" data-complete-task="${task.id}">Complete</button>
      <button class="btn-small btn-danger" data-cancel-task="${task.id}">Cancel</button>
    `;
  }
  if (task.state === "claimed") {
    return `
      <button class="btn-small btn-success" data-complete-task="${task.id}">Complete</button>
      <button class="btn-small btn-danger" data-cancel-task="${task.id}">Cancel</button>
    `;
  }
  return "";
}

function bindUserTaskActions() {
  userTasksTbody.querySelectorAll("[data-view-ut-instance]").forEach((btn) =>
    btn.addEventListener("click", () => {
      const instanceId = (btn as HTMLElement).dataset.viewUtInstance!;
      navigate({ view: "instance-detail", instanceId });
    }),
  );

  userTasksTbody.querySelectorAll("[data-claim-task]").forEach((btn) =>
    btn.addEventListener("click", () =>
      showClaimModal((btn as HTMLElement).dataset.claimTask!),
    ),
  );

  userTasksTbody.querySelectorAll("[data-complete-task]").forEach((btn) =>
    btn.addEventListener("click", () =>
      showCompleteModal((btn as HTMLElement).dataset.completeTask!),
    ),
  );

  userTasksTbody.querySelectorAll("[data-cancel-task]").forEach((btn) =>
    btn.addEventListener("click", async () => {
      const id = (btn as HTMLElement).dataset.cancelTask!;
      if (!confirm(`Cancel user task ${id.slice(0, 8)}?`)) return;
      try {
        await api.cancelUserTask(id);
        setStatus(`Task ${id.slice(0, 8)} cancelled`, "success");
        refreshUserTasks();
      } catch (err) {
        setStatus(`Cancel failed: ${err instanceof Error ? err.message : err}`, "error");
      }
    }),
  );
}

function showClaimModal(taskId: string) {
  modalTitle.textContent = `Claim Task ${taskId.slice(0, 8)}`;
  modalBody.innerHTML = `
    <div class="modal-body-content">
      <label for="claim-user">User</label>
      <input type="text" id="claim-user" placeholder="e.g. alice" />
    </div>
    <div class="modal-actions">
      <button id="modal-cancel-btn">Cancel</button>
      <button id="modal-confirm-btn" class="btn-primary">Claim</button>
    </div>
  `;
  modal.style.display = "flex";

  document.getElementById("modal-cancel-btn")!.addEventListener("click", closeModal);
  document.getElementById("modal-confirm-btn")!.addEventListener("click", async () => {
    const user = (document.getElementById("claim-user") as HTMLInputElement).value.trim();
    if (!user) { setStatus("User is required", "error"); return; }
    try {
      await api.claimUserTask(taskId, user);
      setStatus(`Task ${taskId.slice(0, 8)} claimed by ${user}`, "success");
      closeModal();
      refreshUserTasks();
    } catch (err) {
      setStatus(`Claim failed: ${err instanceof Error ? err.message : err}`, "error");
    }
  });
}

function showCompleteModal(taskId: string) {
  modalTitle.textContent = `Complete Task ${taskId.slice(0, 8)}`;
  modalBody.innerHTML = `
    <div class="modal-body-content">
      <label for="complete-vars">Output Variables (JSON, optional)</label>
      <textarea id="complete-vars" placeholder='{"approved": true}'></textarea>
    </div>
    <div class="modal-actions">
      <button id="modal-cancel-btn">Cancel</button>
      <button id="modal-confirm-btn" class="btn-success">Complete</button>
    </div>
  `;
  modal.style.display = "flex";

  document.getElementById("modal-cancel-btn")!.addEventListener("click", closeModal);
  document.getElementById("modal-confirm-btn")!.addEventListener("click", async () => {
    const raw = (document.getElementById("complete-vars") as HTMLTextAreaElement).value.trim();
    let variables: Record<string, unknown> = {};
    if (raw) {
      try {
        variables = JSON.parse(raw);
      } catch {
        setStatus("Invalid JSON in variables", "error");
        return;
      }
    }
    try {
      await api.completeUserTask(taskId, variables);
      setStatus(`Task ${taskId.slice(0, 8)} completed`, "success");
      closeModal();
      refreshUserTasks();
    } catch (err) {
      setStatus(`Complete failed: ${err instanceof Error ? err.message : err}`, "error");
    }
  });
}

document.getElementById("btn-refresh-user-tasks")!.addEventListener("click", refreshUserTasks);
userTaskStateFilter.addEventListener("change", refreshUserTasks);

// ── Helpers ─────────────────────────────────────────────────
function badge(state: string): string {
  return `<span class="badge badge-${state}">${state}</span>`;
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function fmtDateFull(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("en-US", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + "..." : s;
}

function escHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// Expose for debugging
(window as any).__modeler = modeler;

// ── Boot: read URL and navigate to the right view ──────────
const initialRoute = parseRoute(location.pathname);
navigate(initialRoute, true);
