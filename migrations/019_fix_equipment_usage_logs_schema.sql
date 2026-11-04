-- Restore automatic usage-log IDs and allow the campus/lab labels the app stores.
ALTER TABLE equipment_usage_logs
  MODIFY COLUMN id INT NOT NULL,
  ADD PRIMARY KEY (id);

ALTER TABLE equipment_usage_logs
  MODIFY COLUMN id INT NOT NULL AUTO_INCREMENT,
  MODIFY COLUMN campusId VARCHAR(255) NULL,
  MODIFY COLUMN laboratoryId VARCHAR(255) NULL;
