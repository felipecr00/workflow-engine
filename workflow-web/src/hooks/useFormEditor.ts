import { useEffect, useRef } from 'react';

interface FormEditorLike {
  importSchema: (schema: Record<string, unknown>) => Promise<unknown>;
  saveSchema: () => Record<string, unknown>;
  destroy: () => void;
  on: (event: string, cb: () => void) => void;
}

export function useFormEditor(
  containerRef: React.RefObject<HTMLDivElement | null>,
  onChanged?: () => void,
) {
  const editorRef = useRef<FormEditorLike | null>(null);
  const mountedRef = useRef(false);

  useEffect(() => {
    return () => {
      if (editorRef.current) {
        try { editorRef.current.destroy(); } catch { /* ignore */ }
        editorRef.current = null;
      }
    };
  }, []);

  const mount = async (schema: Record<string, unknown>) => {
    if (!containerRef.current) return;

    if (editorRef.current) {
      try { editorRef.current.destroy(); } catch { /* ignore */ }
      editorRef.current = null;
    }
    containerRef.current.innerHTML = '';

    const { FormEditor } = (await import('@bpmn-io/form-js')) as unknown as {
      FormEditor: new (opts: { container: HTMLElement }) => FormEditorLike;
    };
    const editor = new FormEditor({ container: containerRef.current });
    try {
      await editor.importSchema(schema);
    } catch {
      /* schema import may fail for empty/invalid schemas */
    }
    if (onChanged) {
      editor.on('changed', onChanged);
    }
    editorRef.current = editor;
    mountedRef.current = true;
  };

  return { editorRef, mount };
}

export type { FormEditorLike };
