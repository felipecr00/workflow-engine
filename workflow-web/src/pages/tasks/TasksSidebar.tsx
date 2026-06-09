import { useState } from 'react';
import * as api from '../../api';
import Badge from '../../components/Badge';
import { fmtDate } from '../../utils';

interface Props {
  tasks: api.UserTaskInfo[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  getProcessName: (task: api.UserTaskInfo) => string;
  sortOrder: 'newest' | 'oldest';
  onSortChange: (order: 'newest' | 'oldest') => void;
  onFilterClick: () => void;
  filterCount: number;
  loading: boolean;
}

export default function TasksSidebar({
  tasks,
  selectedId,
  onSelect,
  getProcessName,
  sortOrder,
  onSortChange,
  onFilterClick,
  filterCount,
  loading,
}: Props) {
  return (
    <aside id="tasks-sidebar" aria-label="Task list">
      <div className="tasks-sidebar-header">
        <h2 className="tasks-sidebar-title">All Tasks Open</h2>
        <div className="tasks-sidebar-actions">
          <SortButton sortOrder={sortOrder} onChange={onSortChange} />
          <button
            id="btn-filter-tasks"
            className="btn-small"
            type="button"
            title="Filter tasks"
            onClick={onFilterClick}
          >
            Filters
            {filterCount > 0 && (
              <span className="tasks-filter-count">{filterCount}</span>
            )}
          </button>
        </div>
      </div>
      <div
        id="tasks-list"
        className="tasks-list"
        role="listbox"
        aria-label="All tasks"
        tabIndex={0}
      >
        {tasks.map((task) => {
          const selected = task.id === selectedId;
          const assignee = task.assignee
            ? <span className="task-item-assignee">👤 {task.assignee}</span>
            : <span className="task-item-assignee unassigned">Not Assigned</span>;
          return (
            <div
              key={task.id}
              className={`task-item${selected ? ' selected' : ''}`}
              role="option"
              tabIndex={0}
              aria-selected={selected}
              onClick={() => onSelect(task.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onSelect(task.id);
                }
              }}
            >
              <div className="task-item-title">
                <span className="task-item-name">{task.task_name ?? task.element_id}</span>
                <Badge state={task.state} />
              </div>
              <div className="task-item-process">{getProcessName(task)}</div>
              <div className="task-item-meta">
                {assignee}
                <span className="task-item-date">{fmtDate(task.created_at)}</span>
              </div>
            </div>
          );
        })}
      </div>
      {loading && (
        <div className="tasks-loading">
          <span className="spinner"></span> Loading tasks…
        </div>
      )}
      {!loading && tasks.length === 0 && (
        <div className="tasks-empty-state">
          <div className="tasks-empty-icon">🗒️</div>
          <div className="tasks-empty-title">No tasks available</div>
          <div className="tasks-empty-sub">Tasks created by running processes will appear here.</div>
        </div>
      )}
    </aside>
  );
}

function SortButton({
  sortOrder,
  onChange,
}: {
  sortOrder: 'newest' | 'oldest';
  onChange: (o: 'newest' | 'oldest') => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ position: 'relative' }}>
      <button
        className="btn-small"
        type="button"
        title="Sort by creation date"
        aria-haspopup="true"
        aria-expanded={open}
        onClick={(e) => { e.stopPropagation(); setOpen(!open); }}
      >
        <span className="sort-caret">{sortOrder === 'newest' ? '↓' : '↑'}</span>
        <span>{sortOrder === 'newest' ? 'Newest First' : 'Oldest First'}</span>
      </button>
      {open && (
        <div className="tasks-sort-menu" role="menu">
          {(['newest', 'oldest'] as const).map((o) => (
            <button
              key={o}
              className="tasks-sort-option"
              role="menuitemradio"
              aria-checked={sortOrder === o}
              type="button"
              onClick={() => { onChange(o); setOpen(false); }}
            >
              {o === 'newest' ? 'Newest First' : 'Oldest First'}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
