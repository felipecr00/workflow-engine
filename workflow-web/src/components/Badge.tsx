export default function Badge({ state }: { state: string }) {
  return <span className={`badge badge-${state}`}>{state}</span>;
}
