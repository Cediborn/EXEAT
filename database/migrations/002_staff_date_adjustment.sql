-- Staff date-adjustment workflow.
-- The student's original depart_at / return_at are never overwritten;
-- reviewers record a proposed schedule per approval, and the final approval
-- freezes the authorised schedule in approved_* for the pass and gate rules.
ALTER TABLE exeat_requests ADD COLUMN proposed_depart_at TEXT;
ALTER TABLE exeat_requests ADD COLUMN proposed_return_at TEXT;
ALTER TABLE exeat_requests ADD COLUMN approved_depart_at TEXT;
ALTER TABLE exeat_requests ADD COLUMN approved_return_at TEXT;
ALTER TABLE approval_records ADD COLUMN proposed_depart_at TEXT;
ALTER TABLE approval_records ADD COLUMN proposed_return_at TEXT;
ALTER TABLE approval_records ADD COLUMN date_reason TEXT;
