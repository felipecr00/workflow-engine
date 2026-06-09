import type { ReactNode } from 'react';

interface ModalProps {
  title: string;
  visible: boolean;
  onClose: () => void;
  children: ReactNode;
}

export default function Modal({ title, visible, onClose, children }: ModalProps) {
  if (!visible) return null;

  return (
    <div
      className="modal-backdrop"
      style={{ display: 'flex' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="modal">
        <div className="modal-header">
          <h3>{title}</h3>
          <button className="btn-small" onClick={onClose}>&times;</button>
        </div>
        {children}
      </div>
    </div>
  );
}
