import BpmnModeler from 'bpmn-js/lib/Modeler';
import BpmnViewer from 'bpmn-js/lib/NavigatedViewer';
import {
  BpmnPropertiesPanelModule,
  BpmnPropertiesProviderModule,
  ZeebePropertiesProviderModule,
} from 'bpmn-js-properties-panel';
import zeebeModdle from 'zeebe-bpmn-moddle/resources/zeebe.json';

import 'bpmn-js/dist/assets/diagram-js.css';
import 'bpmn-js/dist/assets/bpmn-js.css';
import 'bpmn-js/dist/assets/bpmn-font/css/bpmn-embedded.css';
import '@bpmn-io/properties-panel/dist/assets/properties-panel.css';
import '@bpmn-io/form-js/dist/assets/form-js.css';
import '@bpmn-io/form-js/dist/assets/form-js-editor.css';

import { DEFAULT_DIAGRAM } from './default-diagram';
import * as api from './api';

// ── Constants ──────────────────────────────────────────────
const BASE_PATH = '/modeler';

// ── Status bar ──────────────────────────────────────────────
const statusMessage = document.getElementById('status-message')!;
function setStatus(msg: string, kind: 'info' | 'success' | 'error' = 'info') {
  statusMessage.textContent = msg;
  statusMessage.className = kind === 'info' ? '' : `status-${kind}`;
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
  taskId?: string;
  // form-editor uses null for a brand-new form, string for editing by key.
  formKey?: string | null;
}

function parseRoute(pathname: string): Route {
  // Strip base path and trailing slash
  let path = pathname;
  if (path.startsWith(BASE_PATH)) path = path.slice(BASE_PATH.length);
  if (path.startsWith('/')) path = path.slice(1);
  if (path.endsWith('/')) path = path.slice(0, -1);

  if (!path || path === '') return { view: 'home' };

  const segments = path.split('/');

  if (segments[0] === 'folders' && segments[1]) {
    return { view: 'home', folderId: segments[1] };
  }
  if (segments[0] === 'projects' && segments[1]) {
    return { view: 'modeler', projectId: segments[1] };
  }
  if (segments[0] === 'instances' && segments[1]) {
    return { view: 'instance-detail', instanceId: segments[1] };
  }
  if (segments[0] === 'instances') return { view: 'instances' };
  if (segments[0] === 'tasks' && segments[1]) {
    return { view: 'tasks', taskId: segments[1] };
  }
  if (segments[0] === 'tasks') return { view: 'tasks' };
  // Legacy path: redirect old /user-tasks bookmarks to the Tasklist workspace.
  if (segments[0] === 'user-tasks') return { view: 'tasks' };
  if (segments[0] === 'incidents') return { view: 'incidents' };

  if (segments[0] === 'forms') {
    if (!segments[1]) return { view: 'forms' };
    if (segments[1] === 'new') return { view: 'form-editor', formKey: null };
    return { view: 'form-editor', formKey: decodeURIComponent(segments[1]) };
  }

  return { view: 'home' };
}

function buildPath(route: Route): string {
  switch (route.view) {
    case 'home':
      return route.folderId
        ? `${BASE_PATH}/folders/${route.folderId}`
        : `${BASE_PATH}/`;
    case 'modeler':
      return `${BASE_PATH}/projects/${route.projectId}`;
    case 'instances':
      return `${BASE_PATH}/instances`;
    case 'instance-detail':
      return `${BASE_PATH}/instances/${route.instanceId}`;
    case 'tasks':
      return route.taskId
        ? `${BASE_PATH}/tasks/${route.taskId}`
        : `${BASE_PATH}/tasks`;
    case 'forms':
      return `${BASE_PATH}/forms`;
    case 'form-editor':
      return route.formKey
        ? `${BASE_PATH}/forms/${encodeURIComponent(route.formKey)}`
        : `${BASE_PATH}/forms/new`;
    case 'incidents':
      return `${BASE_PATH}/incidents`;
    default:
      return `${BASE_PATH}/`;
  }
}

/** Navigate to a route, pushing browser history */
function navigate(route: Route, replace = false) {
  const path = buildPath(route);
  if (replace) {
    history.replaceState(route, '', path);
  } else {
    history.pushState(route, '', path);
  }
  applyRoute(route);
}

/** Apply a route without changing browser history */
function applyRoute(route: Route) {
  // Tear down the form editor if we're leaving its view, otherwise the
  // FormEditor instance survives the route change and re-mounting double-
  // attaches palettes to the same DOM node.
  if (route.view !== 'form-editor' && activeFormEditor) {
    teardownFormEditor();
  }

  // Update tab highlights
  const tabFromView =
    route.view === 'modeler' || route.view === 'instance-detail'
      ? null
      : route.view === 'form-editor'
        ? 'forms'
        : route.view;
  tabs.forEach((t) => t.classList.toggle('active', t.dataset.tab === tabFromView));
  views.forEach((v) =>
    v.classList.toggle('active', v.id === `view-${route.view}`),
  );

  switch (route.view) {
    case 'home':
      currentFolderId = route.folderId ?? null;
      refreshHome();
      break;
    case 'modeler':
      if (route.projectId) openProject(route.projectId, false);
      break;
    case 'instances':
      refreshInstances();
      break;
    case 'instance-detail':
      if (route.instanceId) openInstanceDetail(route.instanceId, false);
      break;
    case 'tasks':
      openTasksView(route.taskId);
      break;
    case 'forms':
      refreshForms();
      break;
    case 'form-editor':
      openFormEditor(route.formKey ?? null);
      break;
    case 'incidents':
      refreshIncidents();
      break;
  }
}

// Handle browser back/forward
window.addEventListener('popstate', (e) => {
  const route = e.state as Route | null;
  if (route) {
    applyRoute(route);
  } else {
    applyRoute(parseRoute(location.pathname));
  }
});

// ── Tab navigation ──────────────────────────────────────────
const tabs = document.querySelectorAll<HTMLButtonElement>('.tab');
const views = document.querySelectorAll<HTMLElement>('.view');

tabs.forEach((t) =>
  t.addEventListener('click', () => {
    const tab = t.dataset.tab!;
    navigate({ view: tab });
  }),
);

// ── Home / Project Browser ─────────────────────────────────
let currentFolderId: string | null = null;
let currentProjectId: string | null = null;
let currentProjectName: string | null = null;

const homeTbody = document.getElementById('home-tbody')!;
const homeEmpty = document.getElementById('home-empty')!;
const breadcrumbsNav = document.getElementById('breadcrumbs')!;

async function refreshHome() {
  try {
    const result = await api.browse(currentFolderId);
    homeTbody.innerHTML = '';
    const hasItems = result.folders.length > 0 || result.projects.length > 0;
    homeEmpty.style.display = hasItems ? 'none' : 'block';

    // Breadcrumbs
    breadcrumbsNav.innerHTML = result.breadcrumbs
      .map((b, i) => {
        const isLast = i === result.breadcrumbs.length - 1;
        if (isLast) return `<span class="current">${escHtml(b.name)}</span>`;
        return `<a data-nav-folder="${b.id ?? ''}">${escHtml(
          b.name,
        )}</a><span class="separator">›</span>`;
      })
      .join('');

    breadcrumbsNav.querySelectorAll('[data-nav-folder]').forEach((a) =>
      a.addEventListener('click', () => {
        const fid = (a as HTMLElement).dataset.navFolder;
        const folderId = fid || undefined;
        navigate({ view: 'home', folderId });
      }),
    );

    // Folders
    for (const folder of result.folders) {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><span class="item-icon item-icon-folder">📁</span></td>
        <td><span class="home-item-name" data-open-folder="${
          folder.id
        }">${escHtml(folder.name)}</span></td>
        <td>${fmtDate(folder.updated_at)}</td>
        <td><button class="btn-small btn-danger" data-delete-folder="${
          folder.id
        }" title="Delete folder">✕</button></td>
      `;
      homeTbody.appendChild(tr);
    }

    // Projects
    for (const project of result.projects) {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><span class="item-icon item-icon-project">⚙</span></td>
        <td>
          <span class="home-item-name" data-open-project="${
            project.id
          }">${escHtml(project.name)}</span>
          ${
            project.description
              ? `<div style="font-size:11px;color:#888;">${escHtml(
                  project.description,
                )}</div>`
              : ''
          }
        </td>
        <td>${fmtDate(project.updated_at)}</td>
        <td><button class="btn-small btn-danger" data-delete-project="${
          project.id
        }" title="Delete">✕</button></td>
      `;
      homeTbody.appendChild(tr);
    }

    // Bind events
    homeTbody.querySelectorAll('[data-open-folder]').forEach((el) =>
      el.addEventListener('click', () => {
        const folderId = (el as HTMLElement).dataset.openFolder!;
        navigate({ view: 'home', folderId });
      }),
    );

    homeTbody.querySelectorAll('[data-open-project]').forEach((el) =>
      el.addEventListener('click', () => {
        const projectId = (el as HTMLElement).dataset.openProject!;
        navigate({ view: 'modeler', projectId });
      }),
    );

    homeTbody.querySelectorAll('[data-delete-folder]').forEach((btn) =>
      btn.addEventListener('click', async () => {
        const id = (btn as HTMLElement).dataset.deleteFolder!;
        if (!confirm('Delete this folder and all its contents?')) return;
        await api.deleteFolder(id);
        refreshHome();
      }),
    );

    homeTbody.querySelectorAll('[data-delete-project]').forEach((btn) =>
      btn.addEventListener('click', async () => {
        const id = (btn as HTMLElement).dataset.deleteProject!;
        if (!confirm('Delete this diagram?')) return;
        await api.deleteProject(id);
        refreshHome();
      }),
    );

    setStatus(
      `${result.folders.length} folder(s), ${result.projects.length} diagram(s)`,
      'success',
    );
  } catch (err) {
    setStatus(
      `Failed to load: ${err instanceof Error ? err.message : err}`,
      'error',
    );
  }
}

document
  .getElementById('btn-new-folder')!
  .addEventListener('click', async () => {
    const name = prompt('Folder name:');
    if (!name) return;
    try {
      await api.createFolder(name, currentFolderId);
      refreshHome();
    } catch (err) {
      setStatus(`Failed: ${err instanceof Error ? err.message : err}`, 'error');
    }
  });

async function handleNewProject() {
  const name = prompt('Diagram name:');
  if (!name) return;
  try {
    const project = await api.createProject(name, currentFolderId);
    navigate({ view: 'modeler', projectId: project.id });
  } catch (err) {
    setStatus(`Failed: ${err instanceof Error ? err.message : err}`, 'error');
  }
}

document
  .getElementById('btn-new-project')!
  .addEventListener('click', handleNewProject);
document
  .getElementById('btn-new-project-empty')!
  .addEventListener('click', handleNewProject);

async function openProject(projectId: string, pushHistory = true) {
  try {
    const project = await api.getProject(projectId);
    currentProjectId = project.id;
    currentProjectName = project.name;
    document.getElementById('project-title')!.textContent = project.name;

    // Show modeler view
    tabs.forEach((t) => t.classList.remove('active'));
    views.forEach((v) => v.classList.toggle('active', v.id === 'view-modeler'));

    if (pushHistory) {
      const route: Route = { view: 'modeler', projectId };
      history.pushState(route, '', buildPath(route));
    }

    await openDiagram(project.bpmn_xml);
    setStatus(`Opened "${project.name}"`, 'success');
  } catch (err) {
    setStatus(
      `Failed to open project: ${err instanceof Error ? err.message : err}`,
      'error',
    );
  }
}

// ── Modeler view ────────────────────────────────────────────
const modeler = new BpmnModeler({
  container: '#canvas',
  propertiesPanel: { parent: '#properties-panel' },
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
    (modeler.get('canvas') as any).zoom('fit-viewport');
    setStatus('Diagram loaded', 'success');
  } catch (err) {
    setStatus(`Failed to load diagram: ${err}`, 'error');
  }
}

document.getElementById('file-input')!.addEventListener('change', (e) => {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    const xml = ev.target?.result as string;
    if (xml) openDiagram(xml);
  };
  reader.readAsText(file);
  (e.target as HTMLInputElement).value = '';
});

document.getElementById('btn-export')!.addEventListener('click', async () => {
  try {
    const { xml } = await modeler.saveXML({ format: true });
    if (!xml) return;
    const blob = new Blob([xml], { type: 'application/xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'process.bpmn';
    a.click();
    URL.revokeObjectURL(url);
    setStatus('Diagram exported', 'success');
  } catch (err) {
    setStatus(`Export failed: ${err}`, 'error');
  }
});

document.getElementById('btn-deploy')!.addEventListener('click', async () => {
  try {
    const { xml } = await modeler.saveXML({ format: true });
    if (!xml) {
      setStatus('No diagram to deploy', 'error');
      return;
    }
    setStatus('Deploying...');
    const result = await api.deployDefinition(
      xml,
      currentProjectName ?? undefined,
    );
    setStatus(
      `Deployed "${result.name ?? result.key}" v${
        result.version
      } (${result.id.slice(0, 8)})`,
      'success',
    );
  } catch (err) {
    setStatus(
      `Deploy failed: ${err instanceof Error ? err.message : err}`,
      'error',
    );
  }
});

document.getElementById('btn-save')!.addEventListener('click', async () => {
  if (!currentProjectId) {
    setStatus('No project open — use Home to create one first', 'error');
    return;
  }
  try {
    const { xml } = await modeler.saveXML({ format: true });
    if (!xml) {
      setStatus('No diagram to save', 'error');
      return;
    }
    await api.saveProject(currentProjectId, { bpmnXml: xml });
    setStatus('Saved', 'success');
  } catch (err) {
    setStatus(
      `Save failed: ${err instanceof Error ? err.message : err}`,
      'error',
    );
  }
});

document.getElementById('btn-back-home')!.addEventListener('click', () => {
  navigate({ view: 'home', folderId: currentFolderId ?? undefined });
});

// ── Modal ──────────────────────────────────────────────────
const modal = document.getElementById('user-task-modal')!;
const modalTitle = document.getElementById('modal-title')!;
const modalBody = document.getElementById('modal-body')!;

document.getElementById('modal-close')!.addEventListener('click', closeModal);
modal.addEventListener('click', (e) => {
  if (e.target === modal) closeModal();
});

function closeModal() {
  modal.style.display = 'none';
  modalBody.innerHTML = '';
}

// ── Instances view ──────────────────────────────────────────
const instancesTbody = document.getElementById('instances-tbody')!;
const instancesEmpty = document.getElementById('instances-empty')!;
const instanceStateFilter = document.getElementById(
  'instance-state-filter',
) as HTMLSelectElement;

async function refreshInstances() {
  try {
    const state = instanceStateFilter.value || undefined;
    const instances = await api.listInstances({ state });
    instancesTbody.innerHTML = '';
    instancesEmpty.style.display = instances.length ? 'none' : 'block';

    for (const inst of instances) {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td class="mono">${inst.id.slice(0, 8)}</td>
        <td>${escHtml(inst.definition_name ?? inst.definition_key)}</td>
        <td>v${inst.definition_version}</td>
        <td>${badge(inst.state)}</td>
        <td>${fmtDate(inst.created_at)}</td>
        <td>${fmtDate(inst.updated_at)}</td>
        <td><button class="btn-small" data-view-instance="${
          inst.id
        }">View</button></td>
      `;
      instancesTbody.appendChild(tr);
    }

    instancesTbody.querySelectorAll('[data-view-instance]').forEach((btn) =>
      btn.addEventListener('click', () => {
        const instanceId = (btn as HTMLElement).dataset.viewInstance!;
        navigate({ view: 'instance-detail', instanceId });
      }),
    );

    setStatus(`${instances.length} instance(s) loaded`, 'success');
  } catch (err) {
    setStatus(
      `Failed to load instances: ${err instanceof Error ? err.message : err}`,
      'error',
    );
  }
}

document
  .getElementById('btn-refresh-instances')!
  .addEventListener('click', refreshInstances);
instanceStateFilter.addEventListener('change', refreshInstances);

document
  .getElementById('btn-start-instance')!
  .addEventListener('click', async () => {
    try {
      const defs = await api.listDefinitions();
      if (defs.length === 0) {
        setStatus('No deployed definitions. Deploy a process first.', 'error');
        return;
      }
      showStartInstanceModal(defs);
    } catch (err) {
      setStatus(
        `Failed to load definitions: ${
          err instanceof Error ? err.message : err
        }`,
        'error',
      );
    }
  });

function showStartInstanceModal(defs: api.DefinitionInfo[]) {
  modalTitle.textContent = 'Start Instance';
  const options = defs
    .map(
      (d) =>
        `<option value="${escHtml(d.key)}">${escHtml(d.name ?? d.key)} (v${
          d.version
        })</option>`,
    )
    .join('');
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
  modal.style.display = 'flex';

  document
    .getElementById('modal-cancel-btn')!
    .addEventListener('click', closeModal);
  document
    .getElementById('modal-confirm-btn')!
    .addEventListener('click', async () => {
      const processKey = (
        document.getElementById('start-process-key') as HTMLSelectElement
      ).value;
      const raw = (
        document.getElementById('start-variables') as HTMLTextAreaElement
      ).value.trim();
      let variables: Record<string, unknown> = {};
      if (raw) {
        try {
          variables = JSON.parse(raw);
        } catch {
          setStatus('Invalid JSON in variables', 'error');
          return;
        }
      }
      try {
        const result = await api.createInstance(processKey, variables);
        setStatus(`Instance ${result.id.slice(0, 8)} started`, 'success');
        closeModal();
        refreshInstances();
      } catch (err) {
        setStatus(
          `Start failed: ${err instanceof Error ? err.message : err}`,
          'error',
        );
      }
    });
}

// ── Instance detail view ────────────────────────────────────
let detailViewer: InstanceType<typeof BpmnViewer> | null = null;
let currentInstanceId: string | null = null;

async function openInstanceDetail(instanceId: string, pushHistory = true) {
  currentInstanceId = instanceId;

  views.forEach((v) => v.classList.remove('active'));
  document.getElementById('view-instance-detail')!.classList.add('active');
  tabs.forEach((t) => t.classList.remove('active'));

  if (pushHistory) {
    const route: Route = { view: 'instance-detail', instanceId };
    history.pushState(route, '', buildPath(route));
  }

  await loadInstanceDetail(instanceId);
}

async function loadInstanceDetail(instanceId: string) {
  try {
    const snapshot = await api.getInstance(instanceId);
    const def = await api.getDefinition(snapshot.definitionId);

    // ── Metadata header ──
    const stateIcon = document.getElementById('detail-state-icon')!;
    if (snapshot.state === 'completed') {
      stateIcon.textContent = '✅';
    } else if (snapshot.state === 'active') {
      stateIcon.textContent = '🔵';
    } else if (snapshot.state === 'terminated') {
      stateIcon.textContent = '🔴';
    } else {
      stateIcon.textContent = '⚪';
    }

    document.getElementById('meta-process-name')!.textContent =
      snapshot.definitionName ?? snapshot.definitionKey;
    document.getElementById('meta-instance-key')!.textContent =
      snapshot.id.slice(0, 16);
    document.getElementById('meta-version')!.textContent = String(
      snapshot.definitionVersion,
    );
    document.getElementById('meta-start-date')!.textContent = snapshot.createdAt
      ? fmtDateFull(snapshot.createdAt)
      : '—';
    document.getElementById('meta-end-date')!.textContent = snapshot.endedAt
      ? fmtDateFull(snapshot.endedAt)
      : '—';

    // ── Render BPMN viewer ──
    if (detailViewer) {
      detailViewer.destroy();
    }
    detailViewer = new BpmnViewer({
      container: '#detail-canvas',
      moddleExtensions: { zeebe: zeebeModdle },
    });
    await detailViewer.importXML(def.bpmn_xml);
    (detailViewer.get('canvas') as any).zoom('fit-viewport');

    const canvas = detailViewer.get('canvas') as any;
    const overlays = detailViewer.get('overlays') as any;
    const elementRegistry = detailViewer.get('elementRegistry') as any;

    // Build set of visited element IDs
    const completedElementIds = new Set(
      snapshot.tokens
        .filter((t) => t.state === 'completed')
        .map((t) => t.element_id),
    );
    const activeElementIds = new Set(
      snapshot.tokens
        .filter(
          (t) =>
            t.state === 'active' ||
            t.state === 'waiting' ||
            t.state === 'incident',
        )
        .map((t) => t.element_id),
    );

    // Color completed elements blue
    for (const elId of completedElementIds) {
      try {
        canvas.addMarker(elId, 'completed-element');
      } catch {
        /* ignore */
      }
    }

    // Color active elements with thick blue border
    for (const elId of activeElementIds) {
      try {
        canvas.addMarker(elId, 'active-element');
      } catch {
        /* ignore */
      }
    }

    // Color sequence flows that connect visited elements
    const allVisited = new Set([...completedElementIds, ...activeElementIds]);
    const allElements = elementRegistry.getAll();
    for (const el of allElements) {
      if (el.type === 'bpmn:SequenceFlow' && el.source && el.target) {
        if (allVisited.has(el.source.id) && allVisited.has(el.target.id)) {
          try {
            canvas.addMarker(el.id, 'completed-flow');
          } catch {
            /* ignore */
          }
        }
      }
    }

    // Token-count badge, pinned exactly on each active activity's top-right
    // corner. The overlay origin is the corner; .token-overlay then centers
    // itself on that point via a CSS translate, so the label width is irrelevant.
    for (const elId of activeElementIds) {
      const tokensHere = snapshot.tokens.filter(
        (t) =>
          t.element_id === elId &&
          (t.state === 'active' ||
            t.state === 'waiting' ||
            t.state === 'incident'),
      );
      if (tokensHere.length === 0) continue;

      const stateClass = tokensHere.some((t) => t.state === 'incident')
        ? 'token-incident'
        : tokensHere.some((t) => t.state === 'active')
        ? 'token-active'
        : 'token-waiting';

      try {
        overlays.add(elId, {
          position: { top: 0, right: 0 },
          html: `<div class="token-overlay ${stateClass}" title="${tokensHere.length} token(s)">${tokensHere.length}</div>`,
        });
      } catch {
        /* ignore */
      }
    }

    // Completed count overlay on end events
    for (const elId of completedElementIds) {
      const el = elementRegistry.get(elId);
      if (el && el.type === 'bpmn:EndEvent') {
        const count = snapshot.tokens.filter(
          (t) => t.element_id === elId && t.state === 'completed',
        ).length;
        try {
          overlays.add(elId, {
            position: { top: 0, right: 0 },
            html: `<div class="token-overlay token-done" title="${count} completed"><span class="tok-check">✓</span><span class="tok-count">${count}</span></div>`,
          });
        } catch {
          /* ignore */
        }
      }
    }

    // ── Instance History tree ──
    renderHistoryTree(snapshot);

    // ── Variables panel ──
    renderVariablesPanel(snapshot);

    setStatus(`Instance ${instanceId.slice(0, 8)} loaded`, 'success');
  } catch (err) {
    setStatus(
      `Failed to load instance: ${err instanceof Error ? err.message : err}`,
      'error',
    );
  }
}

function getElementIcon(elementType: string | null): string {
  switch (elementType) {
    case 'startEvent':
      return '○';
    case 'endEvent':
      return '◉';
    case 'serviceTask':
      return '☐';
    case 'userTask':
      return '☐';
    case 'exclusiveGateway':
      return '◇';
    case 'parallelGateway':
      return '◇';
    case 'intermediateCatchEvent':
      return '⏱';
    default:
      return '•';
  }
}

function getTokenState(elementId: string, tokens: api.TokenInfo[]): string {
  const token = tokens.find((t) => t.element_id === elementId);
  if (!token) return 'completed';
  return token.state;
}

function renderHistoryTree(snap: api.InstanceSnapshot) {
  const tree = document.getElementById('detail-history-tree')!;

  const orderedElements: {
    elementId: string;
    elementType: string;
    name: string;
    state: string;
  }[] = [];
  const seen = new Set<string>();

  const sortedAudit = [...(snap.audit ?? [])].sort(
    (a, b) =>
      new Date(a.occurred_at).getTime() - new Date(b.occurred_at).getTime(),
  );

  for (const evt of sortedAudit) {
    if (!evt.element_id || seen.has(evt.element_id)) continue;
    if (
      evt.event_type === 'TOKEN_CREATED' ||
      evt.event_type === 'TOKEN_COMPLETED'
    ) {
      seen.add(evt.element_id);
      const tokenState = getTokenState(evt.element_id, snap.tokens);
      orderedElements.push({
        elementId: evt.element_id,
        elementType: evt.element_type ?? 'unknown',
        name: evt.element_id,
        state: tokenState,
      });
    }
  }

  const rootState =
    snap.state === 'completed'
      ? 'completed'
      : snap.state === 'active'
      ? 'active'
      : 'incident';
  let html = `
    <div class="history-item">
      <span class="history-icon history-icon-${rootState}">${
    rootState === 'completed' ? '✓' : '●'
  }</span>
      <span class="history-name" style="font-weight:600;">${escHtml(
        snap.definitionName ?? snap.definitionKey,
      )}</span>
    </div>
  `;

  for (const el of orderedElements) {
    const iconClass =
      el.state === 'completed'
        ? 'completed'
        : el.state === 'active' || el.state === 'waiting'
        ? 'active'
        : 'incident';
    const icon = el.state === 'completed' ? '✓' : '●';
    html += `
      <div class="history-item history-item-indent">
        <span class="history-icon history-icon-${iconClass}">${icon}</span>
        <span style="font-size:14px;margin-right:2px;">${getElementIcon(
          el.elementType,
        )}</span>
        <span class="history-name">${escHtml(el.name)}</span>
      </div>
    `;
  }

  tree.innerHTML = html;
}

function renderVariablesPanel(snap: api.InstanceSnapshot) {
  const panel = document.getElementById('detail-variables-content')!;
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

document.getElementById('btn-back-instances')!.addEventListener('click', () => {
  navigate({ view: 'instances' });
});

document.getElementById('btn-refresh-detail')!.addEventListener('click', () => {
  if (currentInstanceId) loadInstanceDetail(currentInstanceId);
});

// ── Incidents view ──────────────────────────────────────────
const incidentsTbody = document.getElementById('incidents-tbody')!;
const incidentsEmpty = document.getElementById('incidents-empty')!;

async function refreshIncidents() {
  try {
    const incidents = await api.listIncidents({ activeOnly: true });
    incidentsTbody.innerHTML = '';
    incidentsEmpty.style.display = incidents.length ? 'none' : 'block';

    for (const inc of incidents) {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td class="mono">${inc.id.slice(0, 8)}</td>
        <td><button class="btn-small" data-view-inc-instance="${
          inc.instance_id
        }">${inc.instance_id.slice(0, 8)}</button></td>
        <td>${inc.type}</td>
        <td title="${escHtml(inc.error_message)}">${truncate(
        inc.error_message,
        50,
      )}</td>
        <td>${badge(inc.state)}</td>
        <td>${fmtDate(inc.created_at)}</td>
        <td>${
          inc.state === 'active'
            ? `<button class="btn-small btn-danger" data-resolve="${inc.id}">Resolve</button>`
            : ''
        }</td>
      `;
      incidentsTbody.appendChild(tr);
    }

    incidentsTbody.querySelectorAll('[data-resolve]').forEach((btn) =>
      btn.addEventListener('click', async () => {
        const id = (btn as HTMLElement).dataset.resolve!;
        try {
          await api.resolveIncident(id);
          setStatus(`Incident ${id.slice(0, 8)} resolved`, 'success');
          refreshIncidents();
        } catch (err) {
          setStatus(
            `Resolve failed: ${err instanceof Error ? err.message : err}`,
            'error',
          );
        }
      }),
    );

    incidentsTbody.querySelectorAll('[data-view-inc-instance]').forEach((btn) =>
      btn.addEventListener('click', () => {
        const instanceId = (btn as HTMLElement).dataset.viewIncInstance!;
        navigate({ view: 'instance-detail', instanceId });
      }),
    );

    setStatus(`${incidents.length} incident(s) loaded`, 'success');
  } catch (err) {
    setStatus(
      `Failed to load incidents: ${err instanceof Error ? err.message : err}`,
      'error',
    );
  }
}

document
  .getElementById('btn-refresh-incidents')!
  .addEventListener('click', refreshIncidents);

// ── Tasks Workspace (Tasklist redesign) ────────────────────
type TaskSortOrder = 'newest' | 'oldest';

interface TaskFilters {
  statuses: string[]; // subset of created|claimed|completed|cancelled; empty = all
  process: string; // process (definition key) or '' for all
  dateFrom: string; // 'YYYY-MM-DD' or ''
  dateTo: string; // 'YYYY-MM-DD' or ''
}

const TASKS_FILTERS_KEY = 'tasks.filters.v1';
const TASKS_SORT_KEY = 'tasks.sort.v1';
const TASK_STATUSES = ['created', 'claimed', 'completed', 'cancelled'];

function defaultTaskFilters(): TaskFilters {
  return { statuses: [], process: '', dateFrom: '', dateTo: '' };
}

// State
let tasksAll: api.UserTaskInfo[] = [];
let tasksSelectedId: string | null = null;
const taskFormCache = new Map<string, api.UserTaskFormPayload | null>();
let activeFormJs: { destroy: () => void } | null = null;
let tasksSortOrder: TaskSortOrder = loadTasksSort();
let tasksAppliedFilters: TaskFilters = loadTasksFilters();
let tasksActiveTab: 'task' | 'process' = 'task';
let tasksProcessRendered = false;
let tasksProcessViewer: InstanceType<typeof BpmnViewer> | null = null;
let tasksCurrentSnapshot: api.InstanceSnapshot | null = null;
const instanceProcessMap = new Map<
  string,
  { key: string; name: string | null; version: number; definitionId: string }
>();
const definitionXmlCache = new Map<string, string>();

// DOM refs
const tasksListEl = document.getElementById('tasks-list')!;
const tasksListLoading = document.getElementById('tasks-list-loading')!;
const tasksListEmpty = document.getElementById('tasks-list-empty')!;
const tasksCenterEmpty = document.getElementById('tasks-center-empty')!;
const tasksCenterContent = document.getElementById('tasks-center-content')!;
const tasksInfoEmpty = document.getElementById('tasks-info-empty')!;
const tasksInfoContent = document.getElementById('tasks-info-content')!;
const tasksTabTask = document.getElementById('tasks-tab-task')!;
const tasksTabProcess = document.getElementById('tasks-tab-process')!;
const tasksProcessLoading = document.getElementById('tasks-process-loading')!;
const sortMenu = document.getElementById('sort-tasks-menu')!;
const sortBtn = document.getElementById('btn-sort-tasks')!;
const sortLabel = document.getElementById('sort-tasks-label')!;

// ── Persistence helpers ──
function loadTasksFilters(): TaskFilters {
  try {
    const raw = localStorage.getItem(TASKS_FILTERS_KEY);
    if (raw) return { ...defaultTaskFilters(), ...JSON.parse(raw) };
  } catch {
    /* ignore */
  }
  return defaultTaskFilters();
}
function saveTasksFilters(f: TaskFilters) {
  try {
    localStorage.setItem(TASKS_FILTERS_KEY, JSON.stringify(f));
  } catch {
    /* ignore */
  }
}
function loadTasksSort(): TaskSortOrder {
  try {
    return localStorage.getItem(TASKS_SORT_KEY) === 'oldest'
      ? 'oldest'
      : 'newest';
  } catch {
    return 'newest';
  }
}
function saveTasksSort(s: TaskSortOrder) {
  try {
    localStorage.setItem(TASKS_SORT_KEY, s);
  } catch {
    /* ignore */
  }
}

// ── Entry point ──
async function openTasksView(taskId?: string) {
  if (taskId) tasksSelectedId = taskId;
  await refreshTasks();
}

async function refreshTasks() {
  tasksListLoading.hidden = false;
  tasksListEmpty.hidden = true;
  try {
    const [tasks, instances] = await Promise.all([
      api.listUserTasks({}),
      api.listInstances({}),
    ]);
    tasksAll = tasks;
    instanceProcessMap.clear();
    for (const inst of instances) {
      instanceProcessMap.set(inst.id, {
        key: inst.definition_key,
        name: inst.definition_name,
        version: inst.definition_version,
        definitionId: inst.definition_id,
      });
    }
    updateSortUi();
    updateFilterCount();
    renderTaskList();

    if (tasksSelectedId && tasksAll.some((t) => t.id === tasksSelectedId)) {
      await selectTask(tasksSelectedId, false);
    } else {
      tasksSelectedId = null;
      showTaskPlaceholder();
    }
    setStatus(`${tasks.length} task(s) loaded`, 'success');
  } catch (err) {
    setStatus(
      `Failed to load tasks: ${err instanceof Error ? err.message : err}`,
      'error',
    );
  } finally {
    tasksListLoading.hidden = true;
  }
}

function getProcessName(task: api.UserTaskInfo): string {
  const entry = instanceProcessMap.get(task.instance_id);
  return entry?.name || entry?.key || 'Unknown Process';
}

function uniqueProcessNames(): string[] {
  const set = new Set<string>();
  for (const t of tasksAll) set.add(getProcessName(t));
  return Array.from(set).sort((a, b) => a.localeCompare(b));
}

// ── List rendering, filtering & sorting ──
function visibleTasks(): api.UserTaskInfo[] {
  const f = tasksAppliedFilters;
  const list = tasksAll.filter((t) => {
    if (f.statuses.length && !f.statuses.includes(t.state)) return false;
    if (f.process && getProcessName(t) !== f.process) return false;
    if (
      f.dateFrom &&
      new Date(t.created_at) < new Date(f.dateFrom + 'T00:00:00')
    )
      return false;
    if (f.dateTo && new Date(t.created_at) > new Date(f.dateTo + 'T23:59:59'))
      return false;
    return true;
  });
  list.sort((a, b) => {
    const da = new Date(a.created_at).getTime();
    const db = new Date(b.created_at).getTime();
    return tasksSortOrder === 'newest' ? db - da : da - db;
  });
  return list;
}

function renderTaskList() {
  const list = visibleTasks();
  tasksListEl.innerHTML = '';
  tasksListEmpty.hidden = list.length > 0;
  tasksListEl.style.display = list.length ? '' : 'none';

  for (const task of list) {
    const selected = task.id === tasksSelectedId;
    const item = document.createElement('div');
    item.className = 'task-item' + (selected ? ' selected' : '');
    item.setAttribute('role', 'option');
    item.setAttribute('tabindex', '0');
    item.setAttribute('aria-selected', String(selected));
    item.dataset.taskId = task.id;
    const assignee = task.assignee
      ? `<span class="task-item-assignee">👤 ${escHtml(task.assignee)}</span>`
      : `<span class="task-item-assignee unassigned">Not Assigned</span>`;
    item.innerHTML = `
      <div class="task-item-title">
        <span class="task-item-name">${escHtml(
          task.task_name ?? task.element_id,
        )}</span>
        ${badge(task.state)}
      </div>
      <div class="task-item-process">${escHtml(getProcessName(task))}</div>
      <div class="task-item-meta">
        ${assignee}
        <span class="task-item-date">${fmtDate(task.created_at)}</span>
      </div>
    `;
    item.addEventListener('click', () => selectTask(task.id));
    item.addEventListener('keydown', (e) => handleTaskItemKeydown(e, task.id));
    tasksListEl.appendChild(item);
  }
}

function handleTaskItemKeydown(e: KeyboardEvent, taskId: string) {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    selectTask(taskId);
  } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    const items = Array.from(
      tasksListEl.querySelectorAll<HTMLElement>('.task-item'),
    );
    const idx = items.findIndex((el) => el.dataset.taskId === taskId);
    const next = e.key === 'ArrowDown' ? items[idx + 1] : items[idx - 1];
    if (next) next.focus();
  }
}

function showTaskPlaceholder() {
  tasksCenterContent.hidden = true;
  tasksCenterEmpty.hidden = false;
  tasksInfoContent.hidden = true;
  tasksInfoEmpty.hidden = false;
}

// ── Task selection & detail ──
async function selectTask(taskId: string, pushHistory = true) {
  tasksSelectedId = taskId;
  tasksListEl.querySelectorAll<HTMLElement>('.task-item').forEach((el) => {
    const sel = el.dataset.taskId === taskId;
    el.classList.toggle('selected', sel);
    el.setAttribute('aria-selected', String(sel));
  });

  if (pushHistory) {
    const route: Route = { view: 'tasks', taskId };
    history.replaceState(route, '', buildPath(route));
  }

  const task = tasksAll.find((t) => t.id === taskId);
  if (!task) {
    showTaskPlaceholder();
    return;
  }

  tasksCenterEmpty.hidden = true;
  tasksCenterContent.hidden = false;
  tasksInfoEmpty.hidden = true;
  tasksInfoContent.hidden = false;

  document.getElementById('tasks-center-process')!.textContent =
    getProcessName(task);
  document.getElementById('tasks-center-task')!.textContent =
    task.task_name ?? task.element_id;

  // New selection resets to the Task tab and invalidates the diagram
  tasksCurrentSnapshot = null;
  tasksProcessRendered = false;
  switchTaskTab('task');

  // Tear down any previous form-js instance before painting the new task
  if (activeFormJs) {
    try { activeFormJs.destroy(); } catch { /* ignore */ }
    activeFormJs = null;
  }

  // Render synchronously with whatever we already know (cached form or no
  // form). Then fetch the detail and re-render if the form just appeared.
  renderTaskForm(task, taskFormCache.get(task.id) ?? undefined);
  renderTaskInfo(task);

  // Enrich the task with its embedded form definition. Backend resolves the
  // form snapshot taken at task-creation time, not the latest version.
  api
    .getUserTaskDetail(taskId)
    .then((detail) => {
      if (tasksSelectedId !== taskId) return;
      taskFormCache.set(taskId, detail.form);
      renderTaskForm(task, detail.form);
    })
    .catch(() => {
      /* fall back to ad-hoc form */
    });

  // Enrich with the full instance snapshot (process name/version + diagram)
  try {
    const snapshot = await api.getInstance(task.instance_id);
    if (tasksSelectedId !== taskId) return; // selection changed while loading
    tasksCurrentSnapshot = snapshot;
    instanceProcessMap.set(task.instance_id, {
      key: snapshot.definitionKey,
      name: snapshot.definitionName,
      version: snapshot.definitionVersion,
      definitionId: snapshot.definitionId,
    });
    document.getElementById('tasks-center-process')!.textContent =
      snapshot.definitionName ?? snapshot.definitionKey;
    renderTaskInfo(task);
  } catch {
    /* snapshot is best-effort */
  }
}

// ── Task tab: generated form ──
function inferFieldType(
  value: unknown,
): 'boolean' | 'number' | 'text' | 'json' {
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'string') return 'text';
  return 'json';
}

function renderFormField(key: string, value: unknown): string {
  const id = `tf-${cssId(key)}`;
  const type = inferFieldType(value);
  const label = `<label for="${id}">${escHtml(
    prettifyKey(key),
  )}<span class="field-hint">${escHtml(key)}</span></label>`;

  if (type === 'boolean') {
    return `<div class="task-field"><div class="task-field-checkbox">
        <input type="checkbox" id="${id}" data-key="${escHtml(
      key,
    )}" data-type="boolean" ${value ? 'checked' : ''} />
        <label for="${id}">${escHtml(
      prettifyKey(key),
    )}<span class="field-hint">${escHtml(key)}</span></label>
      </div></div>`;
  }
  if (type === 'number') {
    return `<div class="task-field">${label}
      <input type="number" id="${id}" data-key="${escHtml(
      key,
    )}" data-type="number" value="${escHtml(String(value))}" /></div>`;
  }
  if (type === 'json') {
    return `<div class="task-field">${label}
      <textarea id="${id}" data-key="${escHtml(
      key,
    )}" data-type="json">${escHtml(
      JSON.stringify(value, null, 2),
    )}</textarea></div>`;
  }
  return `<div class="task-field">${label}
    <input type="text" id="${id}" data-key="${escHtml(
    key,
  )}" data-type="text" value="${escHtml(String(value))}" /></div>`;
}

function renderReadonlyVars(vars: Record<string, unknown>): string {
  const entries = Object.entries(vars ?? {});
  if (!entries.length)
    return `<p style="color:var(--text-tertiary);font-size:0.8125rem;">No variables.</p>`;
  let html = `<table class="var-table"><tbody>`;
  for (const [k, v] of entries) {
    html += `<tr><td>${escHtml(k)}</td><td class="var-value">${escHtml(
      JSON.stringify(v),
    )}</td></tr>`;
  }
  return html + `</tbody></table>`;
}

function renderTaskForm(
  task: api.UserTaskInfo,
  form?: api.UserTaskFormPayload | null,
) {
  const panel = tasksTabTask;

  if (task.state === 'completed' || task.state === 'cancelled') {
    const banner =
      task.state === 'completed'
        ? `<div class="task-form-banner completed">✅ This task has been completed.</div>`
        : `<div class="task-form-banner cancelled">🚫 This task was cancelled.</div>`;
    panel.innerHTML = `
      <div class="task-form-readonly">
        ${banner}
        <div class="task-form-section-title">Submitted Output</div>
        ${renderReadonlyVars(task.output_variables ?? {})}
        <div class="task-form-section-title" style="margin-top:20px;">Task Input</div>
        ${renderReadonlyVars(task.input_variables ?? {})}
      </div>`;
    return;
  }

  if (form && form.format === 'form-js') {
    renderFormJsForm(task, form).catch((err) =>
      setStatus(`Failed to render form: ${err?.message ?? err}`, 'error'),
    );
    return;
  }

  // Fallback: derive ad-hoc inputs from input_variables (existing behavior).
  const entries = Object.entries(task.input_variables ?? {});
  let fields = '';
  if (entries.length === 0) {
    fields = `<p style="color:var(--text-tertiary);font-size:0.8125rem;margin-bottom:16px;">
      This task has no predefined form fields. Use the advanced section below to submit output variables.</p>`;
  } else {
    for (const [key, value] of entries) fields += renderFormField(key, value);
  }

  panel.innerHTML = `
    <form class="task-form" id="task-form" novalidate>
      <div class="task-form-section-title">Form</div>
      ${fields}
      <details class="task-form-advanced">
        <summary>Advanced — additional output variables (JSON)</summary>
        <div class="task-field">
          <textarea id="task-form-json" placeholder='{"approved": true}'></textarea>
        </div>
      </details>
      <div class="task-form-actions">
        <button class="btn-success" id="task-form-complete" type="submit">Complete Task</button>
      </div>
    </form>`;

  (document.getElementById('task-form') as HTMLFormElement).addEventListener(
    'submit',
    (e) => {
      e.preventDefault();
      completeTaskFromForm(task);
    },
  );
}

async function renderFormJsForm(
  task: api.UserTaskInfo,
  form: api.UserTaskFormPayload,
) {
  const panel = tasksTabTask;
  panel.innerHTML = `
    <div class="task-form-formjs">
      <div class="task-form-section-title">Form
        <span class="field-hint">${escHtml(form.key)} v${form.version}</span>
      </div>
      <div id="task-form-formjs-container" class="fjs-host"></div>
      <div id="task-form-formjs-errors" class="task-form-errors" hidden></div>
      <div class="task-form-actions">
        <button class="btn-success" id="task-form-complete" type="button">Complete Task</button>
      </div>
    </div>`;

  const container = document.getElementById(
    'task-form-formjs-container',
  ) as HTMLDivElement;
  const errorsEl = document.getElementById(
    'task-form-formjs-errors',
  ) as HTMLDivElement;

  // Tear down any previous instance (defensive — selectTask also clears).
  if (activeFormJs) {
    try { activeFormJs.destroy(); } catch { /* ignore */ }
    activeFormJs = null;
  }

  const { Form } = await import('@bpmn-io/form-js');
  const fjs = new Form({ container });
  await fjs.importSchema(
    form.schema as Parameters<typeof fjs.importSchema>[0],
    task.input_variables ?? {},
  );
  activeFormJs = fjs;

  const completeBtn = document.getElementById(
    'task-form-complete',
  ) as HTMLButtonElement;

  completeBtn.addEventListener('click', async () => {
    errorsEl.hidden = true;
    errorsEl.innerHTML = '';

    const { data, errors } = fjs.submit();
    const errorEntries = Object.entries(errors ?? {});
    if (errorEntries.length > 0) {
      errorsEl.innerHTML =
        '<strong>Please fix:</strong><ul>' +
        errorEntries
          .map(
            ([field, msgs]) =>
              `<li><code>${escHtml(field)}</code>: ${escHtml(
                Array.isArray(msgs) ? msgs.join(', ') : String(msgs),
              )}</li>`,
          )
          .join('') +
        '</ul>';
      errorsEl.hidden = false;
      return;
    }

    completeBtn.disabled = true;
    completeBtn.textContent = 'Completing…';
    try {
      await api.completeUserTask(task.id, data);
      setStatus(
        `Task "${task.task_name ?? task.element_id}" completed`,
        'success',
      );
      if (activeFormJs === fjs) {
        try { fjs.destroy(); } catch { /* ignore */ }
        activeFormJs = null;
      }
      tasksSelectedId = null;
      await refreshTasks();
    } catch (err) {
      if (err instanceof api.CompleteValidationError) {
        errorsEl.innerHTML =
          '<strong>Server rejected the submission:</strong><ul>' +
          err.details
            .map(
              (d) =>
                `<li><code>${escHtml(d.path)}</code>: ${escHtml(d.message)}</li>`,
            )
            .join('') +
          '</ul>';
        errorsEl.hidden = false;
      } else {
        setStatus(
          `Complete failed: ${err instanceof Error ? err.message : err}`,
          'error',
        );
      }
      completeBtn.disabled = false;
      completeBtn.textContent = 'Complete Task';
    }
  });
}

async function completeTaskFromForm(task: api.UserTaskInfo) {
  const form = document.getElementById('task-form') as HTMLFormElement;
  const output: Record<string, unknown> = {};
  form.querySelectorAll<HTMLElement>('[data-key]').forEach((el) => {
    const key = el.dataset.key!;
    const type = el.dataset.type!;
    if (type === 'boolean') {
      output[key] = (el as HTMLInputElement).checked;
    } else if (type === 'number') {
      const v = (el as HTMLInputElement).value.trim();
      output[key] = v === '' ? null : Number(v);
    } else if (type === 'json') {
      const raw = (el as HTMLTextAreaElement).value.trim();
      if (raw) {
        try {
          output[key] = JSON.parse(raw);
        } catch {
          output[key] = raw;
        }
      }
    } else {
      output[key] = (el as HTMLInputElement).value;
    }
  });

  const advRaw = (
    document.getElementById('task-form-json') as HTMLTextAreaElement | null
  )?.value.trim();
  if (advRaw) {
    try {
      const adv = JSON.parse(advRaw);
      if (adv && typeof adv === 'object') Object.assign(output, adv);
    } catch {
      setStatus('Invalid JSON in advanced output variables', 'error');
      return;
    }
  }

  const btn = document.getElementById(
    'task-form-complete',
  ) as HTMLButtonElement | null;
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Completing…';
  }
  try {
    await api.completeUserTask(task.id, output);
    setStatus(
      `Task "${task.task_name ?? task.element_id}" completed`,
      'success',
    );
    tasksSelectedId = null;
    await refreshTasks();
  } catch (err) {
    setStatus(
      `Complete failed: ${err instanceof Error ? err.message : err}`,
      'error',
    );
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Complete Task';
    }
  }
}

// ── Right info sidebar ──
function infoRow(label: string, value: string, extraClass = ''): string {
  return `<div class="info-row">
    <span class="info-label">${label}</span>
    <span class="info-value ${extraClass}">${value}</span>
  </div>`;
}

function renderTaskInfo(task: api.UserTaskInfo) {
  const proc = instanceProcessMap.get(task.instance_id);
  const created = new Date(task.created_at);
  const groups = task.candidate_groups?.length
    ? escHtml(task.candidate_groups.join(', '))
    : '—';

  let detail = '';
  detail += infoRow('Task ID', task.id.slice(0, 8), 'mono');
  detail += infoRow(
    'Process Name',
    escHtml(proc?.name ?? proc?.key ?? getProcessName(task)),
  );
  if (proc) detail += infoRow('Process Version', `v${proc.version}`);
  detail += infoRow('Instance', task.instance_id.slice(0, 8), 'mono');
  detail += infoRow('Element ID', escHtml(task.element_id), 'mono');
  detail += infoRow('Current Status', badge(task.state));
  detail += infoRow('Assigned User', 'Not Assigned', 'unassigned');
  detail += infoRow('Candidate Groups', groups);
  if (task.claimed_at)
    detail += infoRow('Claimed', fmtDateFull(task.claimed_at));
  if (task.completed_at)
    detail += infoRow('Completed', fmtDateFull(task.completed_at));
  detail += infoRow('Last Updated', fmtDate(task.updated_at));

  tasksInfoContent.innerHTML = `
    <div class="info-section">
      <div class="info-section-title">Creation Information</div>
      ${infoRow(
        'Creation Date',
        created.toLocaleDateString('en-US', {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        }),
      )}
      ${infoRow(
        'Creation Time',
        created.toLocaleTimeString('en-US', {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        }),
      )}
    </div>
    <div class="info-section">
      <div class="info-section-title">Details</div>
      ${detail}
    </div>`;
}

// ── Center tabs (Task / Process) ──
function switchTaskTab(tab: 'task' | 'process') {
  tasksActiveTab = tab;
  const btnTask = document.getElementById('tasks-tab-btn-task')!;
  const btnProcess = document.getElementById('tasks-tab-btn-process')!;
  btnTask.classList.toggle('active', tab === 'task');
  btnProcess.classList.toggle('active', tab === 'process');
  btnTask.setAttribute('aria-selected', String(tab === 'task'));
  btnProcess.setAttribute('aria-selected', String(tab === 'process'));
  btnTask.setAttribute('tabindex', tab === 'task' ? '0' : '-1');
  btnProcess.setAttribute('tabindex', tab === 'process' ? '0' : '-1');
  tasksTabTask.classList.toggle('active', tab === 'task');
  tasksTabProcess.classList.toggle('active', tab === 'process');
  tasksTabTask.hidden = tab !== 'task';
  tasksTabProcess.hidden = tab !== 'process';

  if (tab === 'process' && !tasksProcessRendered) renderTaskProcessDiagram();
}

async function renderTaskProcessDiagram() {
  const task = tasksAll.find((t) => t.id === tasksSelectedId);
  if (!task) return;
  tasksProcessRendered = true;
  tasksProcessLoading.hidden = false;
  try {
    const snapshot =
      tasksCurrentSnapshot ?? (await api.getInstance(task.instance_id));
    tasksCurrentSnapshot = snapshot;
    const definitionId =
      instanceProcessMap.get(task.instance_id)?.definitionId ??
      snapshot.definitionId;

    let xml = definitionXmlCache.get(definitionId);
    if (!xml) {
      const def = await api.getDefinition(definitionId);
      xml = def.bpmn_xml;
      definitionXmlCache.set(definitionId, xml);
    }

    if (tasksProcessViewer) {
      tasksProcessViewer.destroy();
      tasksProcessViewer = null;
    }
    tasksProcessViewer = new BpmnViewer({
      container: '#tasks-process-canvas',
      moddleExtensions: { zeebe: zeebeModdle },
    });
    await tasksProcessViewer.importXML(xml);

    const canvas = tasksProcessViewer.get('canvas') as any;
    const overlays = tasksProcessViewer.get('overlays') as any;
    const elementRegistry = tasksProcessViewer.get('elementRegistry') as any;

    // Completed elements (green), consistent with the instance detail view
    const completed = new Set(
      snapshot.tokens
        .filter((t) => t.state === 'completed')
        .map((t) => t.element_id),
    );
    for (const id of completed) {
      try {
        canvas.addMarker(id, 'completed-element');
      } catch {
        /* ignore */
      }
    }

    // Highlight the current task element and label it
    try {
      if (elementRegistry.get(task.element_id)) {
        canvas.addMarker(task.element_id, 'task-current-element');
        overlays.add(task.element_id, {
          position: { top: 0, left: 0 },
          html: `<div class="task-element-overlay">Current Task</div>`,
        });
      }
    } catch {
      /* ignore */
    }

    requestAnimationFrame(() => {
      try {
        canvas.resized();
        canvas.zoom('fit-viewport');
      } catch {
        /* ignore */
      }
    });
  } catch (err) {
    tasksProcessRendered = false;
    setStatus(
      `Failed to load diagram: ${err instanceof Error ? err.message : err}`,
      'error',
    );
  } finally {
    tasksProcessLoading.hidden = true;
  }
}

// ── Sort menu ──
function updateSortUi() {
  sortLabel.textContent =
    tasksSortOrder === 'newest' ? 'Newest First' : 'Oldest First';
  const caret = document.querySelector('.sort-caret');
  if (caret) caret.textContent = tasksSortOrder === 'newest' ? '↓' : '↑';
  sortMenu
    .querySelectorAll<HTMLElement>('.tasks-sort-option')
    .forEach((opt) => {
      opt.setAttribute(
        'aria-checked',
        String(opt.dataset.sort === tasksSortOrder),
      );
    });
}

function toggleSortMenu(show?: boolean) {
  const willShow = show ?? sortMenu.hidden;
  sortMenu.hidden = !willShow;
  sortBtn.setAttribute('aria-expanded', String(willShow));
}

sortBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  toggleSortMenu();
});
sortMenu.querySelectorAll<HTMLElement>('.tasks-sort-option').forEach((opt) =>
  opt.addEventListener('click', () => {
    tasksSortOrder = opt.dataset.sort === 'oldest' ? 'oldest' : 'newest';
    saveTasksSort(tasksSortOrder);
    updateSortUi();
    renderTaskList();
    toggleSortMenu(false);
  }),
);
document.addEventListener('click', (e) => {
  if (
    !sortMenu.hidden &&
    !sortMenu.contains(e.target as Node) &&
    e.target !== sortBtn
  )
    toggleSortMenu(false);
});

// ── Filter modal ──
function activeFilterCount(f: TaskFilters = tasksAppliedFilters): number {
  let n = 0;
  if (f.statuses.length) n++;
  if (f.process) n++;
  if (f.dateFrom) n++;
  if (f.dateTo) n++;
  return n;
}

function updateFilterCount() {
  const el = document.getElementById('tasks-filter-count')!;
  const n = activeFilterCount();
  el.textContent = String(n);
  el.hidden = n === 0;
}

function readFilterModal(): TaskFilters {
  const statuses = Array.from(
    document.querySelectorAll<HTMLInputElement>('[data-filter-status]'),
  )
    .filter((cb) => cb.checked)
    .map((cb) => cb.value);
  return {
    statuses,
    process: (document.getElementById('filter-process') as HTMLSelectElement)
      .value,
    dateFrom: (document.getElementById('filter-date-from') as HTMLInputElement)
      .value,
    dateTo: (document.getElementById('filter-date-to') as HTMLInputElement)
      .value,
  };
}

function closeFilterModal() {
  document.getElementById('tasks-filter-modal')!.style.display = 'none';
}

function openFilterModal() {
  const modalEl = document.getElementById('tasks-filter-modal')!;
  const body = document.getElementById('tasks-filter-body')!;
  const applied = tasksAppliedFilters;

  const statusChecks = TASK_STATUSES.map((s) => {
    const checked = applied.statuses.includes(s);
    return `<label class="filter-check ${checked ? 'checked' : ''}">
        <input type="checkbox" value="${s}" data-filter-status ${
      checked ? 'checked' : ''
    }/> ${cap(s)}
      </label>`;
  }).join('');

  const processOptions = ['<option value="">All processes</option>']
    .concat(
      uniqueProcessNames().map(
        (p) =>
          `<option value="${escHtml(p)}" ${
            applied.process === p ? 'selected' : ''
          }>${escHtml(p)}</option>`,
      ),
    )
    .join('');

  body.innerHTML = `
    <div class="modal-body-content">
      <div class="filter-group">
        <span class="filter-group-label">Task Status</span>
        <div class="filter-checks">${statusChecks}</div>
      </div>
      <div class="filter-group">
        <span class="filter-group-label">Process</span>
        <select id="filter-process">${processOptions}</select>
      </div>
      <div class="filter-group">
        <span class="filter-group-label">Creation Date Range</span>
        <div class="filter-date-range">
          <div><label>From</label><input type="date" id="filter-date-from" value="${escHtml(
            applied.dateFrom,
          )}"/></div>
          <div><label>To</label><input type="date" id="filter-date-to" value="${escHtml(
            applied.dateTo,
          )}"/></div>
        </div>
      </div>
    </div>
    <div class="modal-actions">
      <button id="filter-clear" class="btn-spacer btn-small" type="button">Clear all</button>
      <button id="filter-cancel" type="button">Cancel</button>
      <button id="filter-save" type="button">Save</button>
      <button id="filter-apply" class="btn-primary" type="button">Apply</button>
    </div>`;

  body
    .querySelectorAll<HTMLInputElement>('[data-filter-status]')
    .forEach((cb) =>
      cb.addEventListener('change', () =>
        cb.closest('.filter-check')!.classList.toggle('checked', cb.checked),
      ),
    );

  document.getElementById('filter-clear')!.addEventListener('click', () => {
    body
      .querySelectorAll<HTMLInputElement>('[data-filter-status]')
      .forEach((cb) => {
        cb.checked = false;
        cb.closest('.filter-check')!.classList.remove('checked');
      });
    (document.getElementById('filter-process') as HTMLSelectElement).value = '';
    (document.getElementById('filter-date-from') as HTMLInputElement).value =
      '';
    (document.getElementById('filter-date-to') as HTMLInputElement).value = '';
  });
  document
    .getElementById('filter-cancel')!
    .addEventListener('click', closeFilterModal);
  document.getElementById('filter-apply')!.addEventListener('click', () => {
    tasksAppliedFilters = readFilterModal();
    updateFilterCount();
    renderTaskList();
    closeFilterModal();
  });
  document.getElementById('filter-save')!.addEventListener('click', () => {
    tasksAppliedFilters = readFilterModal();
    saveTasksFilters(tasksAppliedFilters);
    updateFilterCount();
    renderTaskList();
    closeFilterModal();
    setStatus('Filters saved for future sessions', 'success');
  });

  modalEl.style.display = 'flex';
}

document
  .getElementById('btn-filter-tasks')!
  .addEventListener('click', openFilterModal);
document
  .getElementById('tasks-filter-close')!
  .addEventListener('click', closeFilterModal);
document
  .getElementById('tasks-filter-modal')!
  .addEventListener('click', (e) => {
    if (e.target === document.getElementById('tasks-filter-modal'))
      closeFilterModal();
  });

// Center tab buttons (click + arrow-key navigation)
document.querySelectorAll<HTMLElement>('.tasks-tab').forEach((btn) => {
  btn.addEventListener('click', () =>
    switchTaskTab(btn.dataset.taskTab as 'task' | 'process'),
  );
  btn.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      const next = tasksActiveTab === 'task' ? 'process' : 'task';
      switchTaskTab(next);
      document.getElementById(`tasks-tab-btn-${next}`)!.focus();
    }
  });
});

// ── Tasks helpers ──
function prettifyKey(key: string): string {
  return key
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^./, (c) => c.toUpperCase());
}
function cssId(key: string): string {
  return key.replace(/[^a-zA-Z0-9_-]/g, '_');
}
function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ── Helpers ─────────────────────────────────────────────────
function badge(state: string): string {
  return `<span class="badge badge-${state}">${state}</span>`;
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function fmtDateFull(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('en-US', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + '...' : s;
}

function escHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Forms list view ─────────────────────────────────────────
const formsTbody = document.getElementById('forms-tbody')!;
const formsEmpty = document.getElementById('forms-empty')!;
const formsTable = document.getElementById('forms-table')!;

async function refreshForms() {
  try {
    const forms = await api.listForms();
    formsTbody.innerHTML = '';
    const hasForms = forms.length > 0;
    formsEmpty.style.display = hasForms ? 'none' : 'block';
    formsTable.style.display = hasForms ? '' : 'none';

    for (const f of forms) {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><span class="forms-row-key" data-edit-form="${escHtml(
          f.key,
        )}">${escHtml(f.key)}</span></td>
        <td>v${f.version}</td>
        <td>${escHtml(f.format)}</td>
        <td>${fmtDate(f.deployedAt)}</td>
        <td><button class="btn-small" data-edit-form="${escHtml(
          f.key,
        )}">Edit</button></td>
      `;
      formsTbody.appendChild(tr);
    }

    formsTbody.querySelectorAll('[data-edit-form]').forEach((el) =>
      el.addEventListener('click', () => {
        const key = (el as HTMLElement).dataset.editForm!;
        navigate({ view: 'form-editor', formKey: key });
      }),
    );

    setStatus(`${forms.length} form(s) loaded`, 'success');
  } catch (err) {
    setStatus(
      `Failed to load forms: ${err instanceof Error ? err.message : err}`,
      'error',
    );
  }
}

document
  .getElementById('btn-refresh-forms')!
  .addEventListener('click', refreshForms);

const newFormHandler = () =>
  navigate({ view: 'form-editor', formKey: null });
document.getElementById('btn-new-form')!.addEventListener('click', newFormHandler);
document
  .getElementById('btn-new-form-empty')!
  .addEventListener('click', newFormHandler);

// ── Form editor view ────────────────────────────────────────
// FormEditor instance reference. Kept at module scope so applyRoute can
// destroy it on route change — leaking it would attach a second palette to
// the same DOM on re-entry.
interface FormEditorLike {
  importSchema: (schema: Record<string, unknown>) => Promise<unknown>;
  saveSchema: () => Record<string, unknown>;
  destroy: () => void;
  on: (event: string, cb: () => void) => void;
}
let activeFormEditor: FormEditorLike | null = null;
let activeFormPreview: { destroy: () => void } | null = null;
let activeFormKey: string | null = null;
let activeFormDirty = false;
let activeFormCurrentTab: 'design' | 'preview' | 'json' = 'design';

const EMPTY_FORM_SCHEMA: Record<string, unknown> = {
  type: 'default',
  components: [],
};

function setFormEditorTitle(key: string | null) {
  document.getElementById('form-editor-title')!.textContent =
    key ? key : '(new form)';
}

function setFormEditorDirty(dirty: boolean) {
  activeFormDirty = dirty;
  document.getElementById('form-editor-dirty')!.hidden = !dirty;
}

function teardownFormEditor() {
  if (activeFormEditor) {
    try { activeFormEditor.destroy(); } catch { /* ignore */ }
    activeFormEditor = null;
  }
  if (activeFormPreview) {
    try { activeFormPreview.destroy(); } catch { /* ignore */ }
    activeFormPreview = null;
  }
  document.getElementById('form-editor-design')!.innerHTML = '';
  document.getElementById('form-editor-preview-host')!.innerHTML = '';
  (document.getElementById('form-editor-json-content') as HTMLTextAreaElement)
    .value = '';
  activeFormDirty = false;
  document.getElementById('form-editor-dirty')!.hidden = true;
  activeFormCurrentTab = 'design';
  switchFormEditorTabUi('design');
}

async function openFormEditor(key: string | null) {
  // Always start from a clean slate; navigation reuses the same DOM.
  teardownFormEditor();
  activeFormKey = key;
  setFormEditorTitle(key);
  setFormEditorDirty(false);

  let initialSchema: Record<string, unknown> = EMPTY_FORM_SCHEMA;
  if (key) {
    try {
      const detail = await api.getForm(key);
      initialSchema = detail.schema;
    } catch (err) {
      setStatus(
        `Could not load form "${key}": ${
          err instanceof Error ? err.message : err
        }`,
        'error',
      );
      // Keep the editor open with an empty schema rather than bouncing
      // the user — they may still want to author with this key.
    }
  }

  const designHost = document.getElementById(
    'form-editor-design',
  ) as HTMLDivElement;

  // form-js is ESM-only and adds ~280 KB; load on first use.
  const { FormEditor } = (await import('@bpmn-io/form-js')) as unknown as {
    FormEditor: new (opts: { container: HTMLElement }) => FormEditorLike;
  };
  const editor = new FormEditor({ container: designHost });
  try {
    await editor.importSchema(initialSchema);
  } catch (err) {
    setStatus(
      `Editor failed to load schema: ${err instanceof Error ? err.message : err}`,
      'error',
    );
  }
  editor.on('changed', () => {
    if (!activeFormDirty) setFormEditorDirty(true);
  });
  activeFormEditor = editor;
  setStatus(
    key ? `Editing "${key}"` : 'New form — drop components from the palette',
    'success',
  );
}

function switchFormEditorTabUi(tab: 'design' | 'preview' | 'json') {
  document.querySelectorAll<HTMLElement>('.form-editor-tabs .form-tab').forEach(
    (btn) => {
      const isActive = btn.dataset.formTab === tab;
      btn.classList.toggle('active', isActive);
      btn.setAttribute('aria-selected', String(isActive));
    },
  );
  ['design', 'preview', 'json'].forEach((id) => {
    const el = document.getElementById(`form-editor-${id}`)!;
    const active = id === tab;
    el.classList.toggle('active', active);
    el.hidden = !active;
  });
}

async function switchFormEditorTab(tab: 'design' | 'preview' | 'json') {
  if (!activeFormEditor) {
    switchFormEditorTabUi(tab);
    activeFormCurrentTab = tab;
    return;
  }

  // Snapshot the current schema before swapping panels so Preview and JSON
  // always reflect what the user just authored in Design.
  const schema = activeFormEditor.saveSchema();

  switchFormEditorTabUi(tab);
  activeFormCurrentTab = tab;

  if (tab === 'preview') {
    if (activeFormPreview) {
      try { activeFormPreview.destroy(); } catch { /* ignore */ }
      activeFormPreview = null;
    }
    const previewHost = document.getElementById(
      'form-editor-preview-host',
    ) as HTMLDivElement;
    previewHost.innerHTML = '';
    const { Form } = await import('@bpmn-io/form-js');
    const viewer = new Form({ container: previewHost });
    await viewer.importSchema(
      schema as Parameters<typeof viewer.importSchema>[0],
      {},
    );
    activeFormPreview = viewer;
  } else if (tab === 'json') {
    const ta = document.getElementById(
      'form-editor-json-content',
    ) as HTMLTextAreaElement;
    ta.value = JSON.stringify(schema, null, 2);
  }
}

document.querySelectorAll<HTMLElement>('.form-editor-tabs .form-tab').forEach(
  (btn) => {
    btn.addEventListener('click', () =>
      switchFormEditorTab(btn.dataset.formTab as 'design' | 'preview' | 'json'),
    );
  },
);

document.getElementById('btn-back-forms')!.addEventListener('click', () => {
  navigate({ view: 'forms' });
});

document.getElementById('btn-form-export')!.addEventListener('click', () => {
  if (!activeFormEditor) {
    setStatus('Nothing to export', 'error');
    return;
  }
  const schema = activeFormEditor.saveSchema();
  const blob = new Blob([JSON.stringify(schema, null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${activeFormKey ?? 'form'}.json`;
  a.click();
  URL.revokeObjectURL(url);
  setStatus('Form schema exported', 'success');
});

document
  .getElementById('btn-form-save')!
  .addEventListener('click', async () => {
    if (!activeFormEditor) {
      setStatus('Editor not ready', 'error');
      return;
    }
    let key = activeFormKey;
    if (!key) {
      const entered = prompt('Form key (used to reference this form from BPMN):');
      const trimmed = entered?.trim();
      if (!trimmed) return;
      key = trimmed;
    }

    // saveSchema captures the editor state; the backend re-validates that
    // every component is in the supported subset before persisting.
    const schema = activeFormEditor.saveSchema();
    const btn = document.getElementById('btn-form-save') as HTMLButtonElement;
    btn.disabled = true;
    const originalLabel = btn.textContent;
    btn.textContent = 'Saving…';
    try {
      const result = await api.deployForm(key, schema);
      activeFormKey = result.key;
      setFormEditorTitle(result.key);
      setFormEditorDirty(false);
      setStatus(
        `Deployed "${result.key}" v${result.version}`,
        'success',
      );
      // Keep the user in the editor on the canonical URL for this form so a
      // refresh re-loads the persisted version, not the brand-new path.
      history.replaceState(
        { view: 'form-editor', formKey: result.key },
        '',
        buildPath({ view: 'form-editor', formKey: result.key }),
      );
    } catch (err) {
      if (err instanceof api.UnsupportedFormFieldClientError) {
        setStatus(err.message, 'error');
      } else {
        setStatus(
          `Save failed: ${err instanceof Error ? err.message : err}`,
          'error',
        );
      }
    } finally {
      btn.disabled = false;
      btn.textContent = originalLabel;
    }
  });

// Expose for debugging
(window as any).__modeler = modeler;

// ── Boot: read URL and navigate to the right view ──────────
const initialRoute = parseRoute(location.pathname);
navigate(initialRoute, true);
