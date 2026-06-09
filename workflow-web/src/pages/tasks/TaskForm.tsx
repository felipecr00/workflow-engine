import { useState, useRef, useEffect, useCallback } from 'react';
import * as api from '../../api';
import { useStatus } from '../../hooks/useStatus';
import { escHtml, prettifyKey, cssId } from '../../utils';

interface Props {
  task: api.UserTaskInfo;
  form: api.UserTaskFormPayload | null | undefined;
  onCompleted: () => void;
}

export default function TaskForm({ task, form, onCompleted }: Props) {
  const { setStatus } = useStatus();

  if (task.state === 'completed' || task.state === 'cancelled') {
    return <ReadonlyTaskView task={task} />;
  }

  if (form && form.format === 'form-js') {
    return <FormJsForm task={task} form={form} onCompleted={onCompleted} />;
  }

  return <AdHocForm task={task} onCompleted={onCompleted} />;
}

function ReadonlyTaskView({ task }: { task: api.UserTaskInfo }) {
  const banner = task.state === 'completed'
    ? <div className="task-form-banner completed">✅ This task has been completed.</div>
    : <div className="task-form-banner cancelled">🚫 This task was cancelled.</div>;

  return (
    <div className="task-form-readonly">
      {banner}
      <div className="task-form-section-title">Submitted Output</div>
      <VarTable vars={task.output_variables ?? {}} />
      <div className="task-form-section-title" style={{ marginTop: 20 }}>Task Input</div>
      <VarTable vars={task.input_variables ?? {}} />
    </div>
  );
}

function VarTable({ vars }: { vars: Record<string, unknown> }) {
  const entries = Object.entries(vars);
  if (!entries.length) {
    return <p style={{ color: 'var(--text-tertiary)', fontSize: '0.8125rem' }}>No variables.</p>;
  }
  return (
    <table className="var-table">
      <tbody>
        {entries.map(([k, v]) => (
          <tr key={k}>
            <td>{k}</td>
            <td className="var-value">{JSON.stringify(v)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function FormJsForm({ task, form, onCompleted }: { task: api.UserTaskInfo; form: api.UserTaskFormPayload; onCompleted: () => void }) {
  const { setStatus } = useStatus();
  const containerRef = useRef<HTMLDivElement>(null);
  const formRef = useRef<any>(null);
  const [errors, setErrors] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!containerRef.current) return;
      containerRef.current.innerHTML = '';
      const { Form } = await import('@bpmn-io/form-js');
      if (cancelled) return;
      const fjs = new Form({ container: containerRef.current });
      await fjs.importSchema(
        form.schema as Parameters<typeof fjs.importSchema>[0],
        task.input_variables ?? {},
      );
      formRef.current = fjs;
    })();
    return () => {
      cancelled = true;
      if (formRef.current) {
        try { formRef.current.destroy(); } catch { /* ignore */ }
        formRef.current = null;
      }
    };
  }, [task.id, form]);

  const handleComplete = useCallback(async () => {
    if (!formRef.current) return;
    setErrors('');
    const { data, errors: formErrors } = formRef.current.submit();
    const errorEntries = Object.entries(formErrors ?? {});
    if (errorEntries.length > 0) {
      const msg = errorEntries.map(([field, msgs]) =>
        `${field}: ${Array.isArray(msgs) ? msgs.join(', ') : String(msgs)}`
      ).join('\n');
      setErrors(msg);
      return;
    }
    setSubmitting(true);
    try {
      await api.completeUserTask(task.id, data);
      setStatus(`Task "${task.task_name ?? task.element_id}" completed`, 'success');
      if (formRef.current) {
        try { formRef.current.destroy(); } catch { /* ignore */ }
        formRef.current = null;
      }
      onCompleted();
    } catch (err) {
      if (err instanceof api.CompleteValidationError) {
        setErrors(err.details.map((d) => `${d.path}: ${d.message}`).join('\n'));
      } else {
        setStatus(`Complete failed: ${err instanceof Error ? err.message : err}`, 'error');
      }
      setSubmitting(false);
    }
  }, [task, setStatus, onCompleted]);

  return (
    <div className="task-form-formjs">
      <div className="task-form-section-title">
        Form <span className="field-hint">{form.key} v{form.version}</span>
      </div>
      <div className="fjs-host" ref={containerRef}></div>
      {errors && (
        <div className="task-form-errors">
          <strong>Please fix:</strong>
          <pre style={{ whiteSpace: 'pre-wrap', margin: '4px 0 0' }}>{errors}</pre>
        </div>
      )}
      <div className="task-form-actions">
        <button
          className="btn-success"
          onClick={handleComplete}
          disabled={submitting}
        >
          {submitting ? 'Completing…' : 'Complete Task'}
        </button>
      </div>
    </div>
  );
}

function AdHocForm({ task, onCompleted }: { task: api.UserTaskInfo; onCompleted: () => void }) {
  const { setStatus } = useStatus();
  const [submitting, setSubmitting] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const [advancedJson, setAdvancedJson] = useState('');

  const entries = Object.entries(task.input_variables ?? {});

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formRef.current) return;

    const output: Record<string, unknown> = {};
    formRef.current.querySelectorAll<HTMLElement>('[data-key]').forEach((el) => {
      const key = el.dataset.key!;
      const type = el.dataset.type!;
      if (type === 'boolean') output[key] = (el as HTMLInputElement).checked;
      else if (type === 'number') {
        const v = (el as HTMLInputElement).value.trim();
        output[key] = v === '' ? null : Number(v);
      } else if (type === 'json') {
        const raw = (el as HTMLTextAreaElement).value.trim();
        if (raw) { try { output[key] = JSON.parse(raw); } catch { output[key] = raw; } }
      } else {
        output[key] = (el as HTMLInputElement).value;
      }
    });

    if (advancedJson.trim()) {
      try {
        const adv = JSON.parse(advancedJson);
        if (adv && typeof adv === 'object') Object.assign(output, adv);
      } catch {
        setStatus('Invalid JSON in advanced output variables', 'error');
        return;
      }
    }

    setSubmitting(true);
    try {
      await api.completeUserTask(task.id, output);
      setStatus(`Task "${task.task_name ?? task.element_id}" completed`, 'success');
      onCompleted();
    } catch (err) {
      setStatus(`Complete failed: ${err instanceof Error ? err.message : err}`, 'error');
      setSubmitting(false);
    }
  };

  return (
    <form className="task-form" ref={formRef} noValidate onSubmit={handleSubmit}>
      <div className="task-form-section-title">Form</div>
      {entries.length === 0 ? (
        <p style={{ color: 'var(--text-tertiary)', fontSize: '0.8125rem', marginBottom: 16 }}>
          This task has no predefined form fields. Use the advanced section below to submit output variables.
        </p>
      ) : (
        entries.map(([key, value]) => <FormField key={key} fieldKey={key} value={value} />)
      )}
      <details className="task-form-advanced">
        <summary>Advanced — additional output variables (JSON)</summary>
        <div className="task-field">
          <textarea
            placeholder='{"approved": true}'
            value={advancedJson}
            onChange={(e) => setAdvancedJson(e.target.value)}
          />
        </div>
      </details>
      <div className="task-form-actions">
        <button className="btn-success" type="submit" disabled={submitting}>
          {submitting ? 'Completing…' : 'Complete Task'}
        </button>
      </div>
    </form>
  );
}

function FormField({ fieldKey, value }: { fieldKey: string; value: unknown }) {
  const id = `tf-${cssId(fieldKey)}`;
  const type = typeof value === 'boolean' ? 'boolean'
    : typeof value === 'number' ? 'number'
    : typeof value === 'string' ? 'text' : 'json';

  const label = (
    <label htmlFor={id}>
      {prettifyKey(fieldKey)}
      <span className="field-hint">{fieldKey}</span>
    </label>
  );

  if (type === 'boolean') {
    return (
      <div className="task-field">
        <div className="task-field-checkbox">
          <input type="checkbox" id={id} data-key={fieldKey} data-type="boolean" defaultChecked={value as boolean} />
          <label htmlFor={id}>
            {prettifyKey(fieldKey)}
            <span className="field-hint">{fieldKey}</span>
          </label>
        </div>
      </div>
    );
  }
  if (type === 'number') {
    return (
      <div className="task-field">
        {label}
        <input type="number" id={id} data-key={fieldKey} data-type="number" defaultValue={String(value)} />
      </div>
    );
  }
  if (type === 'json') {
    return (
      <div className="task-field">
        {label}
        <textarea id={id} data-key={fieldKey} data-type="json" defaultValue={JSON.stringify(value, null, 2)} />
      </div>
    );
  }
  return (
    <div className="task-field">
      {label}
      <input type="text" id={id} data-key={fieldKey} data-type="text" defaultValue={String(value)} />
    </div>
  );
}
