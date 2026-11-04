ALTER TABLE equipment
  ADD COLUMN computerLabId INT NULL,
  ADD INDEX idx_equipment_computer_lab (computerLabId);

ALTER TABLE laboratory_schedules
  ADD COLUMN computerLabId INT NULL,
  ADD INDEX idx_laboratory_schedules_computer_lab (computerLabId);

ALTER TABLE attendance_sessions
  ADD COLUMN computerLabId INT NULL,
  ADD INDEX idx_attendance_sessions_computer_lab (computerLabId);

ALTER TABLE attendance
  ADD COLUMN computerLabId INT NULL,
  ADD INDEX idx_attendance_computer_lab (computerLabId);

ALTER TABLE equipment_sets
  ADD COLUMN computerLabId INT NULL,
  ADD INDEX idx_equipment_sets_computer_lab (computerLabId);

ALTER TABLE maintenance_requests
  ADD COLUMN computerLabId INT NULL,
  ADD INDEX idx_maintenance_requests_computer_lab (computerLabId);

ALTER TABLE missing_equipment_history
  ADD COLUMN computerLabId INT NULL,
  ADD INDEX idx_missing_equipment_history_computer_lab (computerLabId);

ALTER TABLE equipment_usage_logs
  ADD COLUMN computerLabId INT NULL,
  ADD INDEX idx_equipment_usage_logs_computer_lab (computerLabId);

ALTER TABLE equipment_technician_reports
  ADD COLUMN computerLabId INT NULL,
  ADD INDEX idx_equipment_technician_reports_computer_lab (computerLabId);

ALTER TABLE equipment_inventory_checks
  ADD COLUMN computerLabId INT NULL,
  ADD INDEX idx_equipment_inventory_checks_computer_lab (computerLabId);

ALTER TABLE archived_records
  ADD COLUMN parentEntityType VARCHAR(64) NULL,
  ADD COLUMN parentEntityId VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL,
  ADD INDEX idx_archived_records_parent (parentEntityType, parentEntityId);
