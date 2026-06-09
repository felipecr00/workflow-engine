import { useRef, useEffect, useCallback, useState } from 'react';
import * as api from '../../api';
import { useBpmnViewer } from '../../hooks/useBpmnViewer';
import { useStatus } from '../../hooks/useStatus';

interface Props {
  task: api.UserTaskInfo;
  snapshot: api.InstanceSnapshot | null;
  definitionId: string | undefined;
  visible: boolean;
}

const definitionXmlCache = new Map<string, string>();

export default function TaskProcessDiagram({ task, snapshot, definitionId, visible }: Props) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const { mount } = useBpmnViewer(canvasRef);
  const { setStatus } = useStatus();
  const [loading, setLoading] = useState(false);
  const [rendered, setRendered] = useState(false);

  const render = useCallback(async () => {
    if (!snapshot || !definitionId) return;
    setLoading(true);
    try {
      let xml = definitionXmlCache.get(definitionId);
      if (!xml) {
        const def = await api.getDefinition(definitionId);
        xml = def.bpmn_xml;
        definitionXmlCache.set(definitionId, xml);
      }

      const viewer = await mount(xml);
      if (!viewer) return;

      const canvas = viewer.get('canvas') as any;
      const overlays = viewer.get('overlays') as any;
      const elementRegistry = viewer.get('elementRegistry') as any;

      const completed = new Set(
        snapshot.tokens.filter((t) => t.state === 'completed').map((t) => t.element_id),
      );
      for (const id of completed) {
        try { canvas.addMarker(id, 'completed-element'); } catch { /* ignore */ }
      }

      try {
        if (elementRegistry.get(task.element_id)) {
          canvas.addMarker(task.element_id, 'task-current-element');
          overlays.add(task.element_id, {
            position: { top: 0, left: 0 },
            html: '<div class="task-element-overlay">Current Task</div>',
          });
        }
      } catch { /* ignore */ }

      requestAnimationFrame(() => {
        try { canvas.resized(); canvas.zoom('fit-viewport'); } catch { /* ignore */ }
      });
      setRendered(true);
    } catch (err) {
      setStatus(`Failed to load diagram: ${err instanceof Error ? err.message : err}`, 'error');
    } finally {
      setLoading(false);
    }
  }, [snapshot, definitionId, task.element_id, mount, setStatus]);

  useEffect(() => {
    if (visible && !rendered) {
      render();
    }
  }, [visible, rendered, render]);

  useEffect(() => {
    setRendered(false);
  }, [task.id]);

  return (
    <>
      {loading && (
        <div className="tasks-loading">
          <span className="spinner"></span> Loading diagram…
        </div>
      )}
      <div id="tasks-process-canvas" className="tasks-process-canvas" ref={canvasRef}></div>
    </>
  );
}
