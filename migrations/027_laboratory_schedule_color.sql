ALTER TABLE laboratory_schedules
  ADD COLUMN scheduleColor VARCHAR(7) NOT NULL DEFAULT '#16a34a' AFTER qrEnabled;
