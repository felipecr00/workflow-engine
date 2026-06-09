import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import * as api from '../api';
import { useStatus } from '../hooks/useStatus';
import { fmtDate, truncate } from '../utils';
import Badge from '../components/Badge';

export default function IncidentsPage() {
  const { setStatus } = useStatus();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data: incidents = [], refetch } = useQuery({
    queryKey: ['incidents'],
    queryFn: () => api.listIncidents({ activeOnly: true }),
  });

  const resolveMutation = useMutation({
    mutationFn: (id: string) => api.resolveIncident(id),
    onSuccess: (_data, id) => {
      setStatus(`Incident ${id.slice(0, 8)} resolved`, 'success');
      queryClient.invalidateQueries({ queryKey: ['incidents'] });
    },
    onError: (err) => {
      setStatus(`Resolve failed: ${err instanceof Error ? err.message : err}`, 'error');
    },
  });

  return (
    <div id="view-incidents" className="view active">
      <div id="incidents-toolbar">
        <div className="toolbar-group">
          <button onClick={() => refetch()}>Refresh</button>
        </div>
      </div>
      <div id="incidents-content">
        <table id="incidents-table" style={{ display: incidents.length ? '' : 'none' }}>
          <thead>
            <tr>
              <th>ID</th>
              <th>Instance</th>
              <th>Type</th>
              <th>Error</th>
              <th>State</th>
              <th>Created</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {incidents.map((inc) => (
              <tr key={inc.id}>
                <td className="mono">{inc.id.slice(0, 8)}</td>
                <td>
                  <button
                    className="btn-small"
                    onClick={() => navigate(`/instances/${inc.instance_id}`)}
                  >
                    {inc.instance_id.slice(0, 8)}
                  </button>
                </td>
                <td>{inc.type}</td>
                <td title={inc.error_message}>{truncate(inc.error_message, 50)}</td>
                <td><Badge state={inc.state} /></td>
                <td>{fmtDate(inc.created_at)}</td>
                <td>
                  {inc.state === 'active' && (
                    <button
                      className="btn-small btn-danger"
                      onClick={() => resolveMutation.mutate(inc.id)}
                    >
                      Resolve
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {incidents.length === 0 && (
          <div className="empty-state">No incidents found</div>
        )}
      </div>
    </div>
  );
}
