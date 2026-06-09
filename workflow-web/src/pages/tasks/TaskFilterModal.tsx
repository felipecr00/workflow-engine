import { useState } from 'react';
import { cap } from '../../utils';

export interface TaskFilters {
  statuses: string[];
  process: string;
  dateFrom: string;
  dateTo: string;
}

const TASK_STATUSES = ['created', 'claimed', 'completed', 'cancelled'];

export function defaultTaskFilters(): TaskFilters {
  return { statuses: [], process: '', dateFrom: '', dateTo: '' };
}

export function activeFilterCount(f: TaskFilters): number {
  let n = 0;
  if (f.statuses.length) n++;
  if (f.process) n++;
  if (f.dateFrom) n++;
  if (f.dateTo) n++;
  return n;
}

interface Props {
  visible: boolean;
  onClose: () => void;
  applied: TaskFilters;
  onApply: (f: TaskFilters) => void;
  onSave: (f: TaskFilters) => void;
  processNames: string[];
}

export default function TaskFilterModal({
  visible,
  onClose,
  applied,
  onApply,
  onSave,
  processNames,
}: Props) {
  const [statuses, setStatuses] = useState<string[]>(applied.statuses);
  const [process, setProcess] = useState(applied.process);
  const [dateFrom, setDateFrom] = useState(applied.dateFrom);
  const [dateTo, setDateTo] = useState(applied.dateTo);

  if (!visible) return null;

  const readFilters = (): TaskFilters => ({ statuses, process, dateFrom, dateTo });

  const clearAll = () => {
    setStatuses([]);
    setProcess('');
    setDateFrom('');
    setDateTo('');
  };

  const toggleStatus = (s: string) => {
    setStatuses((prev) =>
      prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s],
    );
  };

  return (
    <div
      className="modal-backdrop"
      style={{ display: 'flex' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="modal" role="dialog" aria-modal="true">
        <div className="modal-header">
          <h3>Apply Filters</h3>
          <button className="btn-small" type="button" aria-label="Close" onClick={onClose}>
            &times;
          </button>
        </div>
        <div className="modal-body-content">
          <div className="filter-group">
            <span className="filter-group-label">Task Status</span>
            <div className="filter-checks">
              {TASK_STATUSES.map((s) => (
                <label key={s} className={`filter-check${statuses.includes(s) ? ' checked' : ''}`}>
                  <input
                    type="checkbox"
                    checked={statuses.includes(s)}
                    onChange={() => toggleStatus(s)}
                  />
                  {' '}{cap(s)}
                </label>
              ))}
            </div>
          </div>
          <div className="filter-group">
            <span className="filter-group-label">Process</span>
            <select value={process} onChange={(e) => setProcess(e.target.value)}>
              <option value="">All processes</option>
              {processNames.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </div>
          <div className="filter-group">
            <span className="filter-group-label">Creation Date Range</span>
            <div className="filter-date-range">
              <div>
                <label>From</label>
                <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
              </div>
              <div>
                <label>To</label>
                <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
              </div>
            </div>
          </div>
        </div>
        <div className="modal-actions">
          <button className="btn-spacer btn-small" type="button" onClick={clearAll}>Clear all</button>
          <button type="button" onClick={onClose}>Cancel</button>
          <button type="button" onClick={() => { onSave(readFilters()); onClose(); }}>Save</button>
          <button className="btn-primary" type="button" onClick={() => { onApply(readFilters()); onClose(); }}>Apply</button>
        </div>
      </div>
    </div>
  );
}
