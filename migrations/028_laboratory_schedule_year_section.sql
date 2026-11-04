ALTER TABLE laboratory_schedules
  ADD COLUMN yearLevel VARCHAR(30) NULL AFTER instructorUserId,
  ADD COLUMN section VARCHAR(30) NULL AFTER yearLevel;
