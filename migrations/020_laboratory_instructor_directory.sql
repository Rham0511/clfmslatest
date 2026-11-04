CREATE TABLE IF NOT EXISTS instructor_directory (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(120) NOT NULL,
    createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_instructor_directory_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO instructor_directory (name) VALUES
    ('Glenda P. Binay'),
    ('Sheryl Lainez'),
    ('Nico A. Magnaye'),
    ('Uriel Melendrez'),
    ('Christian Cabrera');
