CREATE TABLE IF NOT EXISTS computer_labs (
  id INT NOT NULL AUTO_INCREMENT,
  name VARCHAR(100) NOT NULL,
  roomNumber VARCHAR(50) NULL,
  campus VARCHAR(100) NOT NULL,
  createdBy INT NULL,
  createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_computer_labs_campus (campus),
  CONSTRAINT uq_computer_labs_campus_name_room UNIQUE (campus, name, roomNumber)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
