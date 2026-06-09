import { createContext, useContext, useState, useCallback } from 'react';
import type { ReactNode } from 'react';

type StatusKind = 'info' | 'success' | 'error';

interface StatusContextValue {
  message: string;
  kind: StatusKind;
  setStatus: (msg: string, kind?: StatusKind) => void;
}

const StatusContext = createContext<StatusContextValue>({
  message: 'Ready',
  kind: 'info',
  setStatus: () => {},
});

export function useStatus() {
  return useContext(StatusContext);
}

export function useStatusProvider() {
  const [message, setMessage] = useState('Ready');
  const [kind, setKind] = useState<StatusKind>('info');

  const setStatus = useCallback((msg: string, k: StatusKind = 'info') => {
    setMessage(msg);
    setKind(k);
  }, []);

  return { message, kind, setStatus };
}

export { StatusContext };
export type { StatusKind };
