-- Restore the primary and unique keys expected by the EquipmentSet model.
ALTER TABLE equipment_sets
  MODIFY COLUMN id INT NOT NULL,
  ADD PRIMARY KEY (id),
  ADD UNIQUE KEY uq_equipment_sets_setId (setId);

ALTER TABLE equipment_sets
  MODIFY COLUMN id INT NOT NULL AUTO_INCREMENT;
