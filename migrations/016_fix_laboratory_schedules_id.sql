-- Ensure laboratory schedules receive an ID automatically.
ALTER TABLE laboratory_schedules
  MODIFY COLUMN id INT NOT NULL,
  ADD PRIMARY KEY (id);

ALTER TABLE laboratory_schedules
  MODIFY COLUMN id INT NOT NULL AUTO_INCREMENT;
