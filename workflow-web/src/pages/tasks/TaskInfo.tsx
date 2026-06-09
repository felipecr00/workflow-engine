import * as api from '../../api';
import Badge from '../../components/Badge';
import { fmtDate, fmtDateFull } from '../../utils';

interface ProcessMeta {
  key: string;
  name: string | null;
  version: number;
}

interface Props {
  task: api.UserTaskInfo;
  process: ProcessMeta | undefined;
  getProcessName: (task: api.UserTaskInfo) => string;
}

function infoRow(label: string, value: React.ReactNode, extraClass = '') {
  return (
    <div className="info-row">
      <span className="info-label">{label}</span>
      <span className={`info-value ${extraClass}`}>{value}</span>
    </div>
  );
}

export default function TaskInfo({ task, process, getProcessName }: Props) {
  const created = new Date(task.created_at);
  const groups = task.candidate_groups?.length
    ? task.candidate_groups.join(', ')
    : '—';

  return (
    <div>
      <div className="info-section">
        <div className="info-section-title">Creation Information</div>
        {infoRow('Creation Date', created.toLocaleDateString('en-US', {
          year: 'numeric', month: 'long', day: 'numeric',
        }))}
        {infoRow('Creation Time', created.toLocaleTimeString('en-US', {
          hour: '2-digit', minute: '2-digit', second: '2-digit',
        }))}
      </div>
      <div className="info-section">
        <div className="info-section-title">Details</div>
        {infoRow('Task ID', task.id.slice(0, 8), 'mono')}
        {infoRow('Process Name', process?.name ?? process?.key ?? getProcessName(task))}
        {process && infoRow('Process Version', `v${process.version}`)}
        {infoRow('Instance', task.instance_id.slice(0, 8), 'mono')}
        {infoRow('Element ID', task.element_id, 'mono')}
        {infoRow('Current Status', <Badge state={task.state} />)}
        {infoRow('Assigned User', 'Not Assigned', 'unassigned')}
        {infoRow('Candidate Groups', groups)}
        {task.claimed_at && infoRow('Claimed', fmtDateFull(task.claimed_at))}
        {task.completed_at && infoRow('Completed', fmtDateFull(task.completed_at))}
        {infoRow('Last Updated', fmtDate(task.updated_at))}
      </div>
    </div>
  );
}
