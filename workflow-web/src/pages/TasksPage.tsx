import { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as api from '../api';
import { useStatus } from '../hooks/useStatus';
import { usePersistedState, usePersistedString } from '../hooks/usePersistedState';
import TasksSidebar from './tasks/TasksSidebar';
import TaskForm from './tasks/TaskForm';
import TaskInfo from './tasks/TaskInfo';
import TaskProcessDiagram from './tasks/TaskProcessDiagram';
import TaskFilterModal, {
  type TaskFilters,
  defaultTaskFilters,
  activeFilterCount,
} from './tasks/TaskFilterModal';

type SortOrder = 'newest' | 'oldest';

export default function TasksPage() {
  const { taskId: urlTaskId } = useParams<{ taskId?: string }>();
  const navigate = useNavigate();
  const { setStatus } = useStatus();
  const queryClient = useQueryClient();

  const [selectedId, setSelectedId] = useState<string | null>(urlTaskId ?? null);
  const [activeTab, setActiveTab] = useState<'task' | 'process'>('task');
  const [showFilterModal, setShowFilterModal] = useState(false);
  const [sortOrder, setSortOrder] = usePersistedString('tasks.sort.v1', 'newest') as [SortOrder, (v: string) => void];
  const [filters, setFilters] = usePersistedState<TaskFilters>('tasks.filters.v1', defaultTaskFilters());

  const [snapshot, setSnapshot] = useState<api.InstanceSnapshot | null>(null);
  const [taskForm, setTaskForm] = useState<api.UserTaskFormPayload | null>(null);

  const { data: tasksData, isLoading } = useQuery({
    queryKey: ['user-tasks'],
    queryFn: () => Promise.all([api.listUserTasks({}), api.listInstances({})]),
  });

  const allTasks = tasksData?.[0] ?? [];
  const instances = tasksData?.[1] ?? [];

  const instanceProcessMap = useMemo(() => {
    const map = new Map<string, { key: string; name: string | null; version: number; definitionId: string }>();
    for (const inst of instances) {
      map.set(inst.id, {
        key: inst.definition_key,
        name: inst.definition_name,
        version: inst.definition_version,
        definitionId: inst.definition_id,
      });
    }
    return map;
  }, [instances]);

  const getProcessName = useCallback((task: api.UserTaskInfo): string => {
    const entry = instanceProcessMap.get(task.instance_id);
    return entry?.name || entry?.key || 'Unknown Process';
  }, [instanceProcessMap]);

  const uniqueProcessNames = useMemo(() => {
    const set = new Set<string>();
    for (const t of allTasks) set.add(getProcessName(t));
    return Array.from(set).sort();
  }, [allTasks, getProcessName]);

  const visibleTasks = useMemo(() => {
    const f = filters;
    const list = allTasks.filter((t) => {
      if (f.statuses.length && !f.statuses.includes(t.state)) return false;
      if (f.process && getProcessName(t) !== f.process) return false;
      if (f.dateFrom && new Date(t.created_at) < new Date(f.dateFrom + 'T00:00:00')) return false;
      if (f.dateTo && new Date(t.created_at) > new Date(f.dateTo + 'T23:59:59')) return false;
      return true;
    });
    list.sort((a, b) => {
      const da = new Date(a.created_at).getTime();
      const db = new Date(b.created_at).getTime();
      return sortOrder === 'newest' ? db - da : da - db;
    });
    return list;
  }, [allTasks, filters, sortOrder, getProcessName]);

  useEffect(() => {
    if (tasksData) {
      setStatus(`${allTasks.length} task(s) loaded`, 'success');
    }
  }, [tasksData, allTasks.length, setStatus]);

  const selectedTask = allTasks.find((t) => t.id === selectedId) ?? null;

  const selectTask = useCallback(async (id: string) => {
    setSelectedId(id);
    setActiveTab('task');
    setSnapshot(null);
    setTaskForm(null);
    navigate(`/tasks/${id}`, { replace: true });

    const task = allTasks.find((t) => t.id === id);
    if (!task) return;

    api.getUserTaskDetail(id).then((detail) => {
      setTaskForm(detail.form);
    }).catch(() => { /* fall back to ad-hoc form */ });

    try {
      const snap = await api.getInstance(task.instance_id);
      setSnapshot(snap);
      instanceProcessMap.set(task.instance_id, {
        key: snap.definitionKey,
        name: snap.definitionName,
        version: snap.definitionVersion,
        definitionId: snap.definitionId,
      });
    } catch { /* best-effort */ }
  }, [allTasks, navigate, instanceProcessMap]);

  useEffect(() => {
    if (urlTaskId && allTasks.length > 0 && urlTaskId !== selectedId) {
      selectTask(urlTaskId);
    }
  }, [urlTaskId, allTasks, selectedId, selectTask]);

  const handleCompleted = useCallback(() => {
    setSelectedId(null);
    queryClient.invalidateQueries({ queryKey: ['user-tasks'] });
  }, [queryClient]);

  const process = selectedTask ? instanceProcessMap.get(selectedTask.instance_id) : undefined;
  const definitionId = process?.definitionId ?? snapshot?.definitionId;

  return (
    <div id="view-tasks" className="view active">
      <div id="tasks-layout">
        <TasksSidebar
          tasks={visibleTasks}
          selectedId={selectedId}
          onSelect={selectTask}
          getProcessName={getProcessName}
          sortOrder={sortOrder as SortOrder}
          onSortChange={(o) => setSortOrder(o)}
          onFilterClick={() => setShowFilterModal(true)}
          filterCount={activeFilterCount(filters)}
          loading={isLoading}
        />

        <section id="tasks-center" aria-label="Task workspace">
          {!selectedTask ? (
            <div className="tasks-center-empty">
              <div className="tasks-empty-icon">📋</div>
              <div className="tasks-empty-title">Select a task</div>
              <div className="tasks-empty-sub">Choose a task from the list to view and complete it.</div>
            </div>
          ) : (
            <div className="tasks-center-content">
              <div className="tasks-center-header">
                <div className="tasks-center-process">
                  {snapshot?.definitionName ?? getProcessName(selectedTask)}
                </div>
                <div className="tasks-center-task">
                  {selectedTask.task_name ?? selectedTask.element_id}
                </div>
              </div>

              <div className="tasks-tabbar" role="tablist" aria-label="Task views">
                <button
                  className={`tasks-tab${activeTab === 'task' ? ' active' : ''}`}
                  role="tab"
                  aria-selected={activeTab === 'task'}
                  onClick={() => setActiveTab('task')}
                >
                  Task
                </button>
                <button
                  className={`tasks-tab${activeTab === 'process' ? ' active' : ''}`}
                  role="tab"
                  aria-selected={activeTab === 'process'}
                  onClick={() => setActiveTab('process')}
                >
                  Process
                </button>
              </div>

              <div className="tasks-tab-panels">
                <div
                  className={`tasks-tab-panel${activeTab === 'task' ? ' active' : ''}`}
                  role="tabpanel"
                  hidden={activeTab !== 'task'}
                >
                  <TaskForm
                    key={selectedTask.id}
                    task={selectedTask}
                    form={taskForm}
                    onCompleted={handleCompleted}
                  />
                </div>
                <div
                  className={`tasks-tab-panel${activeTab === 'process' ? ' active' : ''}`}
                  role="tabpanel"
                  hidden={activeTab !== 'process'}
                >
                  <TaskProcessDiagram
                    task={selectedTask}
                    snapshot={snapshot}
                    definitionId={definitionId}
                    visible={activeTab === 'process'}
                  />
                </div>
              </div>
            </div>
          )}
        </section>

        <aside id="tasks-info" className="tasks-info" aria-label="Task information">
          {!selectedTask ? (
            <div className="tasks-info-empty">
              <div className="tasks-empty-icon">ℹ️</div>
              <div className="tasks-empty-sub">Task details will appear here.</div>
            </div>
          ) : (
            <div id="tasks-info-content">
              <TaskInfo
                task={selectedTask}
                process={process}
                getProcessName={getProcessName}
              />
            </div>
          )}
        </aside>
      </div>

      <TaskFilterModal
        visible={showFilterModal}
        onClose={() => setShowFilterModal(false)}
        applied={filters}
        onApply={setFilters}
        onSave={(f) => {
          setFilters(f);
          setStatus('Filters saved for future sessions', 'success');
        }}
        processNames={uniqueProcessNames}
      />
    </div>
  );
}
