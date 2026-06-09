import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import * as api from '../api';
import { useStatus } from '../hooks/useStatus';
import { fmtDate } from '../utils';

export default function FormsListPage() {
  const { setStatus } = useStatus();
  const navigate = useNavigate();

  const { data: forms = [], refetch } = useQuery({
    queryKey: ['forms'],
    queryFn: async () => {
      const result = await api.listForms();
      setStatus(`${result.length} form(s) loaded`, 'success');
      return result;
    },
  });

  const handleNew = () => navigate('/forms/new');

  return (
    <div id="view-forms" className="view active">
      <div id="forms-toolbar">
        <div className="toolbar-group">
          <button onClick={() => refetch()}>Refresh</button>
        </div>
        <div className="toolbar-group">
          <button className="btn-primary" onClick={handleNew}>New Form</button>
        </div>
      </div>
      <div id="forms-content">
        {forms.length > 0 && (
          <table id="forms-table">
            <thead>
              <tr>
                <th>Key</th>
                <th>Version</th>
                <th>Format</th>
                <th>Deployed At</th>
                <th style={{ width: 80 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {forms.map((f) => (
                <tr key={`${f.key}-${f.version}`}>
                  <td>
                    <span
                      className="forms-row-key"
                      onClick={() => navigate(`/forms/${encodeURIComponent(f.key)}`)}
                      style={{ cursor: 'pointer' }}
                    >
                      {f.key}
                    </span>
                  </td>
                  <td>v{f.version}</td>
                  <td>{f.format}</td>
                  <td>{fmtDate(f.deployedAt)}</td>
                  <td>
                    <button
                      className="btn-small"
                      onClick={() => navigate(`/forms/${encodeURIComponent(f.key)}`)}
                    >
                      Edit
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {forms.length === 0 && (
          <div className="empty-state">
            <div style={{ marginBottom: 12 }}>No forms yet</div>
            <button className="btn-primary" onClick={handleNew}>
              Create your first form
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
