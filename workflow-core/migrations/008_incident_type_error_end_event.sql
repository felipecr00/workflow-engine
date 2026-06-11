-- Distinct incident type for Error End Events so dashboards/queries can
-- tell them apart from handler failures (job_retries_exhausted) or
-- unhandled errors at task creation time (unhandled_error).
-- In Sprint 6 this incident type will become the trigger that propagates
-- to a boundary error catch; for now it just stops the token.
ALTER TYPE incident_type ADD VALUE IF NOT EXISTS 'error_end_event';
