-- Ensure attendance records receive an ID automatically.
ALTER TABLE attendance
  MODIFY COLUMN id INT NOT NULL,
  ADD PRIMARY KEY (id);

ALTER TABLE attendance
  MODIFY COLUMN id INT NOT NULL AUTO_INCREMENT;
