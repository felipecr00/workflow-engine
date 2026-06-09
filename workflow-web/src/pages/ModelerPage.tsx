import { useRef, useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import * as api from '../api';
import { useStatus } from '../hooks/useStatus';
import { useBpmnModeler } from '../hooks/useBpmnModeler';
import { DEFAULT_DIAGRAM } from '../default-diagram';

export default function ModelerPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const { setStatus } = useStatus();

  const containerRef = useRef<HTMLDivElement>(null);
  const propertiesPanelRef = useRef<HTMLDivElement>(null);
  const modelerRef = useBpmnModeler(containerRef, propertiesPanelRef);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [projectName, setProjectName] = useState('');

  const { data: project } = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => api.getProject(projectId!),
    enabled: !!projectId,
  });

  useEffect(() => {
    if (!project || !modelerRef.current) return;
    setProjectName(project.name);
    const modeler = modelerRef.current;
    modeler
      .importXML(project.bpmn_xml || DEFAULT_DIAGRAM)
      .then(() => {
        (modeler.get('canvas') as any).zoom('fit-viewport');
        setStatus(`Opened "${project.name}"`, 'success');
      })
      .catch((err: unknown) => {
        setStatus(`Failed to load diagram: ${err}`, 'error');
      });
  }, [project, modelerRef, setStatus]);

  const handleSave = useCallback(async () => {
    if (!projectId || !modelerRef.current) {
      setStatus('No project open — use Home to create one first', 'error');
      return;
    }
    try {
      const { xml } = await modelerRef.current.saveXML({ format: true });
      if (!xml) { setStatus('No diagram to save', 'error'); return; }
      await api.saveProject(projectId, { bpmnXml: xml });
      setStatus('Saved', 'success');
    } catch (err) {
      setStatus(`Save failed: ${err instanceof Error ? err.message : err}`, 'error');
    }
  }, [projectId, modelerRef, setStatus]);

  const handleImport = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !modelerRef.current) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const xml = ev.target?.result as string;
      if (xml && modelerRef.current) {
        modelerRef.current.importXML(xml).then(() => {
          (modelerRef.current!.get('canvas') as any).zoom('fit-viewport');
          setStatus('Diagram loaded', 'success');
        }).catch((err: unknown) => setStatus(`Failed to load diagram: ${err}`, 'error'));
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  }, [modelerRef, setStatus]);

  const handleExport = useCallback(async () => {
    if (!modelerRef.current) return;
    try {
      const { xml } = await modelerRef.current.saveXML({ format: true });
      if (!xml) return;
      const blob = new Blob([xml], { type: 'application/xml' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'process.bpmn';
      a.click();
      URL.revokeObjectURL(url);
      setStatus('Diagram exported', 'success');
    } catch (err) {
      setStatus(`Export failed: ${err}`, 'error');
    }
  }, [modelerRef, setStatus]);

  const handleDeploy = useCallback(async () => {
    if (!modelerRef.current) return;
    try {
      const { xml } = await modelerRef.current.saveXML({ format: true });
      if (!xml) { setStatus('No diagram to deploy', 'error'); return; }
      setStatus('Deploying...');
      const result = await api.deployDefinition(xml, projectName || undefined);
      setStatus(
        `Deployed "${result.name ?? result.key}" v${result.version} (${result.id.slice(0, 8)})`,
        'success',
      );
    } catch (err) {
      setStatus(`Deploy failed: ${err instanceof Error ? err.message : err}`, 'error');
    }
  }, [modelerRef, projectName, setStatus]);

  return (
    <div id="view-modeler" className="view active">
      <div id="modeler-toolbar">
        <div className="toolbar-group">
          <button onClick={() => navigate('/')}>&larr; Home</button>
          <span id="project-title" style={{ fontWeight: 600, fontSize: 13 }}>
            {projectName}
          </span>
        </div>
        <div className="toolbar-group">
          <button onClick={handleSave} title="Save diagram">Save</button>
          <label className="toolbar-btn" title="Import BPMN XML">
            Import
            <input
              ref={fileInputRef}
              type="file"
              accept=".bpmn,.xml"
              hidden
              onChange={handleImport}
            />
          </label>
          <button onClick={handleExport} title="Export BPMN XML">Export</button>
          <button className="btn-primary" onClick={handleDeploy} title="Deploy to engine">
            Deploy
          </button>
        </div>
      </div>
      <div id="canvas-container">
        <div id="canvas" ref={containerRef}></div>
        <div id="properties-panel" ref={propertiesPanelRef}></div>
      </div>
    </div>
  );
}
