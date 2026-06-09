import { useRef, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import * as api from '../api';
import { useStatus } from '../hooks/useStatus';
import { useBpmnViewer } from '../hooks/useBpmnViewer';
import { fmtDateFull } from '../utils';

function getElementIcon(elementType: string | null): string {
  switch (elementType) {
    case 'startEvent': return '○';
    case 'endEvent': return '◉';
    case 'serviceTask': return '☐';
    case 'userTask': return '☐';
    case 'exclusiveGateway': return '◇';
    case 'parallelGateway': return '◇';
    case 'intermediateCatchEvent': return '⏱';
    default: return '•';
  }
}

function getTokenState(elementId: string, tokens: api.TokenInfo[]): string {
  const token = tokens.find((t) => t.element_id === elementId);
  if (!token) return 'completed';
  return token.state;
}

export default function InstanceDetailPage() {
  const { instanceId } = useParams<{ instanceId: string }>();
  const navigate = useNavigate();
  const { setStatus } = useStatus();
  const canvasRef = useRef<HTMLDivElement>(null);
  const { viewerRef, mount } = useBpmnViewer(canvasRef);

  const { data: snapshot, refetch } = useQuery({
    queryKey: ['instance', instanceId],
    queryFn: () => api.getInstance(instanceId!),
    enabled: !!instanceId,
  });

  const { data: definition } = useQuery({
    queryKey: ['definition', snapshot?.definitionId],
    queryFn: () => api.getDefinition(snapshot!.definitionId),
    enabled: !!snapshot?.definitionId,
  });

  const applyOverlays = useCallback(async () => {
    if (!definition || !snapshot) return;

    const viewer = await mount(definition.bpmn_xml);
    if (!viewer) return;

    const canvas = viewer.get('canvas') as any;
    const overlays = viewer.get('overlays') as any;
    const elementRegistry = viewer.get('elementRegistry') as any;

    const completedElementIds = new Set(
      snapshot.tokens.filter((t) => t.state === 'completed').map((t) => t.element_id),
    );
    const activeElementIds = new Set(
      snapshot.tokens
        .filter((t) => t.state === 'active' || t.state === 'waiting' || t.state === 'incident')
        .map((t) => t.element_id),
    );

    for (const elId of completedElementIds) {
      try { canvas.addMarker(elId, 'completed-element'); } catch { /* ignore */ }
    }
    for (const elId of activeElementIds) {
      try { canvas.addMarker(elId, 'active-element'); } catch { /* ignore */ }
    }

    const allVisited = new Set([...completedElementIds, ...activeElementIds]);
    for (const el of elementRegistry.getAll()) {
      if (el.type === 'bpmn:SequenceFlow' && el.source && el.target) {
        if (allVisited.has(el.source.id) && allVisited.has(el.target.id)) {
          try { canvas.addMarker(el.id, 'completed-flow'); } catch { /* ignore */ }
        }
      }
    }

    for (const elId of activeElementIds) {
      const tokensHere = snapshot.tokens.filter(
        (t) => t.element_id === elId && (t.state === 'active' || t.state === 'waiting' || t.state === 'incident'),
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
      } catch { /* ignore */ }
    }

    for (const elId of completedElementIds) {
      const el = elementRegistry.get(elId);
      if (el && el.type === 'bpmn:EndEvent') {
        const count = snapshot.tokens.filter((t) => t.element_id === elId && t.state === 'completed').length;
        try {
          overlays.add(elId, {
            position: { top: 0, right: 0 },
            html: `<div class="token-overlay token-done" title="${count} completed"><span class="tok-check">✓</span><span class="tok-count">${count}</span></div>`,
          });
        } catch { /* ignore */ }
      }
    }

    setStatus(`Instance ${instanceId!.slice(0, 8)} loaded`, 'success');
  }, [definition, snapshot, mount, instanceId, setStatus]);

  useEffect(() => {
    applyOverlays();
  }, [applyOverlays]);

  if (!snapshot) return null;

  const stateIcon = snapshot.state === 'completed' ? '✅'
    : snapshot.state === 'active' ? '🔵'
    : snapshot.state === 'terminated' ? '🔴' : '⚪';

  const orderedElements: { elementId: string; elementType: string; name: string; state: string }[] = [];
  const seen = new Set<string>();
  const sortedAudit = [...(snapshot.audit ?? [])].sort(
    (a, b) => new Date(a.occurred_at).getTime() - new Date(b.occurred_at).getTime(),
  );
  for (const evt of sortedAudit) {
    if (!evt.element_id || seen.has(evt.element_id)) continue;
    if (evt.event_type === 'TOKEN_CREATED' || evt.event_type === 'TOKEN_COMPLETED') {
      seen.add(evt.element_id);
      orderedElements.push({
        elementId: evt.element_id,
        elementType: evt.element_type ?? 'unknown',
        name: evt.element_id,
        state: getTokenState(evt.element_id, snapshot.tokens),
      });
    }
  }

  const rootState = snapshot.state === 'completed' ? 'completed'
    : snapshot.state === 'active' ? 'active' : 'incident';

  const variables = Object.entries(snapshot.variables ?? {});

  return (
    <div id="view-instance-detail" className="view active">
      <div id="detail-meta-bar">
        <div className="meta-item">
          <span id="detail-state-icon" className="meta-icon">{stateIcon}</span>
        </div>
        <div className="meta-item">
          <div className="meta-label">Process Name</div>
          <div className="meta-value">{snapshot.definitionName ?? snapshot.definitionKey}</div>
        </div>
        <div className="meta-item">
          <div className="meta-label">Instance Key</div>
          <div className="meta-value mono">{snapshot.id.slice(0, 16)}</div>
        </div>
        <div className="meta-item">
          <div className="meta-label">Version</div>
          <div className="meta-value">{snapshot.definitionVersion}</div>
        </div>
        <div className="meta-item">
          <div className="meta-label">Start Date</div>
          <div className="meta-value">{snapshot.createdAt ? fmtDateFull(snapshot.createdAt) : '—'}</div>
        </div>
        <div className="meta-item">
          <div className="meta-label">End Date</div>
          <div className="meta-value">{snapshot.endedAt ? fmtDateFull(snapshot.endedAt) : '—'}</div>
        </div>
        <div className="meta-item" style={{ marginLeft: 'auto' }}>
          <button className="btn-small" onClick={() => navigate('/instances')}>&larr; Instances</button>
          <button className="btn-small" onClick={() => refetch()}>Refresh</button>
        </div>
      </div>
      <div id="detail-diagram-area">
        <div id="detail-canvas" ref={canvasRef}></div>
      </div>
      <div id="detail-bottom-panel">
        <div id="detail-history-panel">
          <div className="panel-header">Instance History</div>
          <div id="detail-history-tree">
            <div className="history-item">
              <span className={`history-icon history-icon-${rootState}`}>
                {rootState === 'completed' ? '✓' : '●'}
              </span>
              <span className="history-name" style={{ fontWeight: 600 }}>
                {snapshot.definitionName ?? snapshot.definitionKey}
              </span>
            </div>
            {orderedElements.map((el) => {
              const iconClass = el.state === 'completed' ? 'completed'
                : (el.state === 'active' || el.state === 'waiting') ? 'active' : 'incident';
              return (
                <div key={el.elementId} className="history-item history-item-indent">
                  <span className={`history-icon history-icon-${iconClass}`}>
                    {el.state === 'completed' ? '✓' : '●'}
                  </span>
                  <span style={{ fontSize: 14, marginRight: 2 }}>{getElementIcon(el.elementType)}</span>
                  <span className="history-name">{el.name}</span>
                </div>
              );
            })}
          </div>
        </div>
        <div id="detail-variables-panel">
          <div className="panel-header">Variables</div>
          <div id="detail-variables-content">
            {variables.length === 0 ? (
              <div style={{ padding: 20, textAlign: 'center', color: 'rgba(255,255,255,0.4)', fontSize: 13 }}>
                The Flow Node has no Variables
              </div>
            ) : (
              <table className="var-table">
                <thead><tr><th>Name</th><th>Value</th></tr></thead>
                <tbody>
                  {variables.map(([key, value]) => (
                    <tr key={key}>
                      <td>{key}</td>
                      <td className="var-value">{JSON.stringify(value)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
