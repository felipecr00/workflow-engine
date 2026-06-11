-- Adds the 'cancelled' value to job_state. A Terminate End Event must mark
-- in-flight jobs of the terminated instance as cancelled so workers
-- claiming them can detect they are no longer relevant — 'completed' or
-- 'failed' would mislead retry/audit logic.
ALTER TYPE job_state ADD VALUE IF NOT EXISTS 'cancelled';
