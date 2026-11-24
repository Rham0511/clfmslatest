ALTER TABLE pc_station_sessions
  ADD COLUMN IF NOT EXISTS endedAt DATETIME NULL,
  ADD COLUMN IF NOT EXISTS sessionStatus VARCHAR(20) NULL;

UPDATE pc_station_sessions
SET sessionStatus = 'active'
WHERE activeUserId IS NOT NULL AND sessionStatus IS NULL;
