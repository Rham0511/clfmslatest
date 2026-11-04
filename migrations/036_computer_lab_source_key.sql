ALTER TABLE computer_labs
  ADD COLUMN sourceKey VARCHAR(191) NULL,
  ADD UNIQUE KEY uq_computer_labs_campus_source_key (campus, sourceKey);
