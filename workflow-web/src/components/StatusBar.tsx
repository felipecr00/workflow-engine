import { useStatus } from '../hooks/useStatus';

export default function StatusBar() {
  const { message, kind } = useStatus();
  return (
    <div id="status-bar">
      <span
        id="status-message"
        className={kind === 'info' ? '' : `status-${kind}`}
      >
        {message}
      </span>
    </div>
  );
}
