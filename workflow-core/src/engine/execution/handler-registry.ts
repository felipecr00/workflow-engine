export interface JobContext {
  jobId: string;
  instanceId: string;
  elementId: string;
  variables: Record<string, unknown>;
}

export type JobHandler = (
  ctx: JobContext,
) => Promise<Record<string, unknown> | void> | Record<string, unknown> | void;

export class HandlerRegistry {
  private readonly handlers = new Map<string, JobHandler>();

  register(type: string, handler: JobHandler): void {
    if (this.handlers.has(type)) {
      throw new Error(`Handler already registered for type "${type}"`);
    }
    this.handlers.set(type, handler);
  }

  unregister(type: string): void {
    this.handlers.delete(type);
  }

  has(type: string): boolean {
    return this.handlers.has(type);
  }

  get(type: string): JobHandler | undefined {
    return this.handlers.get(type);
  }
}
