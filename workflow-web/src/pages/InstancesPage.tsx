import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import * as api from '../api';
import { useStatus } from '../hooks/useStatus';
import { fmtDate } from '../utils';
import Badge from '../components/Badge';
import Modal from '../components/Modal';

export default function InstancesPage() {
  const { setStatus } = useStatus();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [stateFilter, setStateFilter] = useState('');
  const [showStartModal, setShowStartModal] = useState(false);

  const { data: instances = [], refetch } = useQuery({
    queryKey: ['instances', stateFilter],
    queryFn: async () => {
      const result = await api.listInstances({ state: stateFilter || undefined });
      setStatus(`${result.length} instance(s) loaded`, 'success');
      return result;
    },
  });

  return (
    <div id="view-instances" className="view active">
      <div id="instances-toolbar">
        <div className="toolbar-group">
          <select
            id="instance-state-filter"
            value={stateFilter}
            onChange={(e) => setStateFilter(e.target.value)}
          >
            <option value="">All states</option>
            <option value="active">Active</option>
            <option value="completed">Completed</option>
            <option value="terminated">Terminated</option>
          </select>
          <button onClick={() => refetch()}>Refresh</button>
          <button className="btn-primary" onClick={() => setShowStartModal(true)}>
            Start Instance
          </button>
        </div>
      </div>
      <div id="instances-content">
        {instances.length > 0 && (
          <table id="instances-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Process</th>
                <th>Version</th>
                <th>State</th>
                <th>Created</th>
                <th>Updated</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {instances.map((inst) => (
                <tr key={inst.id}>
                  <td className="mono">{inst.id.slice(0, 8)}</td>
                  <td>{inst.definition_name ?? inst.definition_key}</td>
                  <td>v{inst.definition_version}</td>
                  <td><Badge state={inst.state} /></td>
                  <td>{fmtDate(inst.created_at)}</td>
                  <td>{fmtDate(inst.updated_at)}</td>
                  <td>
                    <button
                      className="btn-small"
                      onClick={() => navigate(`/instances/${inst.id}`)}
                    >
                      View
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {instances.length === 0 && (
          <div className="empty-state">No instances found</div>
        )}
      </div>
      <StartInstanceModal
        visible={showStartModal}
        onClose={() => setShowStartModal(false)}
        onStarted={() => {
          setShowStartModal(false);
          queryClient.invalidateQueries({ queryKey: ['instances'] });
        }}
      />
    </div>
  );
}

function StartInstanceModal({
  visible,
  onClose,
  onStarted,
}: {
  visible: boolean;
  onClose: () => void;
  onStarted: () => void;
}) {
  const { setStatus } = useStatus();
  const [processKey, setProcessKey] = useState('');
  const [variables, setVariables] = useState('');

  const { data: defs = [] } = useQuery({
    queryKey: ['definitions'],
    queryFn: () => api.listDefinitions(),
    enabled: visible,
  });

  const startMutation = useMutation({
    mutationFn: (params: { processKey: string; variables: Record<string, unknown> }) =>
      api.createInstance(params.processKey, params.variables),
    onSuccess: (result) => {
      setStatus(`Instance ${result.id.slice(0, 8)} started`, 'success');
      setVariables('');
      onStarted();
    },
    onError: (err) => {
      setStatus(`Start failed: ${err instanceof Error ? err.message : err}`, 'error');
    },
  });

  const handleStart = () => {
    const key = processKey || defs[0]?.key;
    if (!key) return;

    let vars: Record<string, unknown> = {};
    if (variables.trim()) {
      try {
        vars = JSON.parse(variables);
      } catch {
        setStatus('Invalid JSON in variables', 'error');
        return;
      }
    }
    startMutation.mutate({ processKey: key, variables: vars });
  };

  if (defs.length === 0 && visible) {
    return (
      <Modal title="Start Instance" visible={visible} onClose={onClose}>
        <div className="modal-body-content">
          <p>No deployed definitions. Deploy a process first.</p>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title="Start Instance" visible={visible} onClose={onClose}>
      <div className="modal-body-content">
        <label htmlFor="start-process-key">Process</label>
        <select
          id="start-process-key"
          value={processKey || defs[0]?.key || ''}
          onChange={(e) => setProcessKey(e.target.value)}
        >
          {defs.map((d) => (
            <option key={d.key} value={d.key}>
              {d.name ?? d.key} (v{d.version})
            </option>
          ))}
        </select>
        <label htmlFor="start-variables">Variables (JSON, optional)</label>
        <textarea
          id="start-variables"
          placeholder='{"orderId": "ORD-001"}'
          value={variables}
          onChange={(e) => setVariables(e.target.value)}
        />
      </div>
      <div className="modal-actions">
        <button onClick={onClose}>Cancel</button>
        <button className="btn-primary" onClick={handleStart}>Start</button>
      </div>
    </Modal>
  );
}
