const BASE = '';

// ── Folders & Projects ─────────────────────────────────────

export interface FolderInfo {
  id: string;
  name: string;
  parent_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProjectInfo {
  id: string;
  name: string;
  folder_id: string | null;
  bpmn_xml: string;
  description: string | null;
  deployed_definition_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface Breadcrumb {
  id: string | null;
  name: string;
}

export interface BrowseResult {
  folders: FolderInfo[];
  projects: ProjectInfo[];
  breadcrumbs: Breadcrumb[];
}

export async function browse(folderId?: string | null): Promise<BrowseResult> {
  const params = new URLSearchParams();
  if (folderId) params.set('folderId', folderId);
  const qs = params.toString();
  const res = await fetch(`${BASE}/browse${qs ? '?' + qs : ''}`);
  if (!res.ok) throw new Error('Failed to browse');
  const body = await res.json();
  return {
    folders: body.folders ?? [],
    projects: body.projects ?? [],
    breadcrumbs: body.breadcrumbs ?? [{ id: null, name: 'Home' }],
  };
}

export async function createFolder(
  name: string,
  parentId?: string | null,
): Promise<FolderInfo> {
  const res = await fetch(`${BASE}/folders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, parentId: parentId ?? null }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.message ?? 'Create folder failed');
  return body as FolderInfo;
}

export async function deleteFolder(id: string): Promise<void> {
  await fetch(`${BASE}/folders/${id}`, { method: 'DELETE' });
}

export async function createProject(
  name: string,
  folderId?: string | null,
): Promise<ProjectInfo> {
  const res = await fetch(`${BASE}/projects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, folderId: folderId ?? null }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.message ?? 'Create project failed');
  return body as ProjectInfo;
}

export async function getProject(id: string): Promise<ProjectInfo> {
  const res = await fetch(`${BASE}/projects/${id}`);
  const body = await res.json();
  if (!res.ok) throw new Error(body.message ?? 'Not found');
  return body as ProjectInfo;
}

export async function saveProject(
  id: string,
  updates: {
    bpmnXml?: string;
    name?: string;
    deployedDefinitionId?: string | null;
  },
): Promise<ProjectInfo> {
  const res = await fetch(`${BASE}/projects/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.message ?? 'Save failed');
  return body as ProjectInfo;
}

export async function deleteProject(id: string): Promise<void> {
  await fetch(`${BASE}/projects/${id}`, { method: 'DELETE' });
}

// ── Engine API ─────────────────────────────────────────────

export interface DeployResult {
  id: string;
  key: string;
  version: number;
  name: string | null;
  deployedAt: string;
}

export interface InstanceSummary {
  id: string;
  definition_id: string;
  definition_key: string;
  definition_version: number;
  definition_name: string | null;
  state: string;
  created_at: string;
  updated_at: string;
  ended_at: string | null;
}

export interface TokenInfo {
  id: string;
  element_id: string;
  element_type: string;
  state: string;
}

export interface JobInfo {
  id: string;
  element_id: string;
  job_type: string;
  state: string;
  error_message: string | null;
}

export interface IncidentInfo {
  id: string;
  instance_id: string;
  token_id: string | null;
  job_id: string | null;
  type: string;
  state: string;
  error_message: string;
  created_at: string;
  resolved_at: string | null;
}

export interface InstanceSnapshot {
  id: string;
  definitionId: string;
  definitionKey: string;
  definitionVersion: number;
  definitionName: string | null;
  state: string;
  variables: Record<string, unknown>;
  tokens: TokenInfo[];
  jobs: JobInfo[];
  incidents: IncidentInfo[];
  userTasks: UserTaskInfo[];
  audit: AuditEvent[];
  createdAt?: string;
  endedAt?: string | null;
}

export interface AuditEvent {
  id: string;
  event_type: string;
  element_id: string | null;
  element_type: string | null;
  occurred_at: string;
  metadata: Record<string, unknown>;
}

export interface DefinitionInfo {
  id: string;
  key: string;
  version: number;
  name: string | null;
  bpmn_xml: string;
}

export async function listDefinitions(): Promise<DefinitionInfo[]> {
  const res = await fetch(`${BASE}/definitions`);
  const body = await res.json();
  return body.definitions as DefinitionInfo[];
}

export async function createInstance(
  processKey: string,
  variables?: Record<string, unknown>,
): Promise<{ id: string }> {
  const res = await fetch(`${BASE}/instances`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ processKey, variables: variables ?? {} }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.message ?? 'Create instance failed');
  return body as { id: string };
}

export async function deployDefinition(
  bpmnXml: string,
  name?: string,
): Promise<DeployResult> {
  const res = await fetch(`${BASE}/definitions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ bpmnXml, name }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.message ?? 'Deploy failed');
  return body as DeployResult;
}

export async function getDefinition(id: string): Promise<DefinitionInfo> {
  const res = await fetch(`${BASE}/definitions/${id}`);
  const body = await res.json();
  if (!res.ok) throw new Error(body.message ?? 'Not found');
  return body as DefinitionInfo;
}

export async function listInstances(
  filter: {
    state?: string;
    definitionKey?: string;
  } = {},
): Promise<InstanceSummary[]> {
  const params = new URLSearchParams();
  if (filter.state) params.set('state', filter.state);
  if (filter.definitionKey) params.set('definitionKey', filter.definitionKey);
  const qs = params.toString();
  const res = await fetch(`${BASE}/instances${qs ? '?' + qs : ''}`);
  const body = await res.json();
  return body.instances as InstanceSummary[];
}

export async function getInstance(id: string): Promise<InstanceSnapshot> {
  const res = await fetch(`${BASE}/instances/${id}`);
  const body = await res.json();
  if (!res.ok) throw new Error(body.message ?? 'Not found');
  return body as InstanceSnapshot;
}

export async function listIncidents(
  filter: {
    instanceId?: string;
    activeOnly?: boolean;
  } = {},
): Promise<IncidentInfo[]> {
  const params = new URLSearchParams();
  if (filter.instanceId) params.set('instanceId', filter.instanceId);
  if (filter.activeOnly === false) params.set('activeOnly', 'false');
  const qs = params.toString();
  const res = await fetch(`${BASE}/incidents${qs ? '?' + qs : ''}`);
  const body = await res.json();
  return body.incidents as IncidentInfo[];
}

export interface UserTaskInfo {
  id: string;
  instance_id: string;
  element_id: string;
  task_name: string | null;
  assignee: string | null;
  candidate_groups: string[];
  state: string;
  input_variables: Record<string, unknown>;
  output_variables: Record<string, unknown> | null;
  claimed_by: string | null;
  claimed_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export async function listUserTasks(
  filter: {
    instanceId?: string;
    state?: string;
    assignee?: string;
  } = {},
): Promise<UserTaskInfo[]> {
  const params = new URLSearchParams();
  if (filter.instanceId) params.set('instanceId', filter.instanceId);
  if (filter.state) params.set('state', filter.state);
  if (filter.assignee) params.set('assignee', filter.assignee);
  const qs = params.toString();
  const res = await fetch(`${BASE}/user-tasks${qs ? '?' + qs : ''}`);
  const body = await res.json();
  return body.userTasks as UserTaskInfo[];
}

export async function claimUserTask(
  id: string,
  claimedBy: string,
): Promise<void> {
  const res = await fetch(`${BASE}/user-tasks/${id}/claim`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ claimedBy }),
  });
  if (!res.ok) {
    const body = await res.json();
    throw new Error(body.message ?? 'Claim failed');
  }
}

export async function completeUserTask(
  id: string,
  variables?: Record<string, unknown>,
): Promise<void> {
  const res = await fetch(`${BASE}/user-tasks/${id}/complete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ variables: variables ?? {} }),
  });
  if (!res.ok) {
    const body = await res.json();
    throw new Error(body.message ?? 'Complete failed');
  }
}

export async function cancelUserTask(id: string): Promise<void> {
  const res = await fetch(`${BASE}/user-tasks/${id}/cancel`, {
    method: 'POST',
  });
  if (!res.ok) {
    const body = await res.json();
    throw new Error(body.message ?? 'Cancel failed');
  }
}

export async function resolveIncident(id: string): Promise<void> {
  const res = await fetch(`${BASE}/incidents/${id}/resolve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ resolvedBy: 'modeler-ui' }),
  });
  if (!res.ok) {
    const body = await res.json();
    throw new Error(body.message ?? 'Resolve failed');
  }
}
