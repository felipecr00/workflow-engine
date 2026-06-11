-- Adds the 'cancelled' value to token_state so Terminate End Events can
-- atomically retire all live tokens of an instance without re-using
-- 'completed' (which semantically means "finished its element normally").
ALTER TYPE token_state ADD VALUE IF NOT EXISTS 'cancelled';
