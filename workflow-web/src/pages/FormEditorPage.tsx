import { useRef, useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import * as api from '../api';
import { useStatus } from '../hooks/useStatus';
import { useFormEditor } from '../hooks/useFormEditor';

const EMPTY_FORM_SCHEMA: Record<string, unknown> = {
  type: 'default',
  components: [],
};

export default function FormEditorPage() {
  const { formKey } = useParams<{ formKey?: string }>();
  const location = useLocation();
  const isNew = location.pathname.endsWith('/new');
  const effectiveKey = isNew ? null : (formKey ? decodeURIComponent(formKey) : null);

  const navigate = useNavigate();
  const { setStatus } = useStatus();

  const designRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const [activeTab, setActiveTab] = useState<'design' | 'preview' | 'json'>('design');
  const [dirty, setDirty] = useState(false);
  const [currentKey, setCurrentKey] = useState<string | null>(effectiveKey);
  const [jsonText, setJsonText] = useState('');
  const previewInstanceRef = useRef<{ destroy: () => void } | null>(null);

  const { editorRef, mount } = useFormEditor(designRef, () => {
    if (!dirty) setDirty(true);
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let schema = EMPTY_FORM_SCHEMA;
      if (effectiveKey) {
        try {
          const detail = await api.getForm(effectiveKey);
          schema = detail.schema;
        } catch (err) {
          setStatus(
            `Could not load form "${effectiveKey}": ${err instanceof Error ? err.message : err}`,
            'error',
          );
        }
      }
      if (cancelled) return;
      setCurrentKey(effectiveKey);
      setDirty(false);
      await mount(schema);
      setStatus(
        effectiveKey
          ? `Editing "${effectiveKey}"`
          : 'New form — drop components from the palette',
        'success',
      );
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveKey]);

  const switchTab = useCallback(async (tab: 'design' | 'preview' | 'json') => {
    setActiveTab(tab);
    if (!editorRef.current) return;
    const schema = editorRef.current.saveSchema();

    if (tab === 'preview') {
      if (previewInstanceRef.current) {
        try { previewInstanceRef.current.destroy(); } catch { /* ignore */ }
        previewInstanceRef.current = null;
      }
      if (previewRef.current) {
        previewRef.current.innerHTML = '';
        const { Form } = await import('@bpmn-io/form-js');
        const viewer = new Form({ container: previewRef.current });
        await viewer.importSchema(
          schema as Parameters<typeof viewer.importSchema>[0],
          {},
        );
        previewInstanceRef.current = viewer;
      }
    } else if (tab === 'json') {
      setJsonText(JSON.stringify(schema, null, 2));
    }
  }, [editorRef]);

  const handleExport = useCallback(() => {
    if (!editorRef.current) { setStatus('Nothing to export', 'error'); return; }
    const schema = editorRef.current.saveSchema();
    const blob = new Blob([JSON.stringify(schema, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${currentKey ?? 'form'}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setStatus('Form schema exported', 'success');
  }, [editorRef, currentKey, setStatus]);

  const handleSave = useCallback(async () => {
    if (!editorRef.current) { setStatus('Editor not ready', 'error'); return; }
    let key = currentKey;
    if (!key) {
      const entered = prompt('Form key (used to reference this form from BPMN):');
      const trimmed = entered?.trim();
      if (!trimmed) return;
      key = trimmed;
    }
    const schema = editorRef.current.saveSchema();
    try {
      const result = await api.deployForm(key, schema);
      setCurrentKey(result.key);
      setDirty(false);
      setStatus(`Deployed "${result.key}" v${result.version}`, 'success');
      navigate(`/forms/${encodeURIComponent(result.key)}`, { replace: true });
    } catch (err) {
      if (err instanceof api.UnsupportedFormFieldClientError) {
        setStatus(err.message, 'error');
      } else {
        setStatus(`Save failed: ${err instanceof Error ? err.message : err}`, 'error');
      }
    }
  }, [editorRef, currentKey, setStatus, navigate]);

  useEffect(() => {
    return () => {
      if (previewInstanceRef.current) {
        try { previewInstanceRef.current.destroy(); } catch { /* ignore */ }
      }
    };
  }, []);

  return (
    <div id="view-form-editor" className="view active">
      <div id="form-editor-toolbar">
        <div className="toolbar-group">
          <button onClick={() => navigate('/forms')}>&larr; Forms</button>
          <span id="form-editor-title" style={{ fontWeight: 600, fontSize: 13 }}>
            {currentKey ?? '(new form)'}
          </span>
          {dirty && (
            <span className="form-editor-dirty" title="Unsaved changes">●</span>
          )}
        </div>
        <div className="toolbar-group form-editor-tabs" role="tablist" aria-label="Form editor views">
          {(['design', 'preview', 'json'] as const).map((tab) => (
            <button
              key={tab}
              className={`form-tab${activeTab === tab ? ' active' : ''}`}
              role="tab"
              aria-selected={activeTab === tab}
              onClick={() => switchTab(tab)}
            >
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </div>
        <div className="toolbar-group">
          <button onClick={handleExport}>Export</button>
          <button className="btn-primary" onClick={handleSave}>Save &amp; Deploy</button>
        </div>
      </div>
      <div id="form-editor-content">
        <div
          id="form-editor-design"
          className={`form-editor-panel${activeTab === 'design' ? ' active' : ''}`}
          hidden={activeTab !== 'design'}
          ref={designRef}
        />
        <div
          id="form-editor-preview"
          className={`form-editor-panel${activeTab === 'preview' ? ' active' : ''}`}
          hidden={activeTab !== 'preview'}
        >
          <div id="form-editor-preview-host" className="form-editor-preview-host" ref={previewRef} />
        </div>
        <div
          id="form-editor-json"
          className={`form-editor-panel${activeTab === 'json' ? ' active' : ''}`}
          hidden={activeTab !== 'json'}
        >
          <textarea
            id="form-editor-json-content"
            className="form-json-editor"
            spellCheck={false}
            readOnly
            value={jsonText}
          />
        </div>
      </div>
    </div>
  );
}
