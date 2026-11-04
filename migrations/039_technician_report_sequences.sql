CREATE TABLE IF NOT EXISTS technician_report_sequences (
    reportYear SMALLINT UNSIGNED NOT NULL PRIMARY KEY,
    lastNumber INT UNSIGNED NOT NULL DEFAULT 0,
    updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO technician_report_sequences (reportYear, lastNumber)
SELECT CAST(SUBSTRING(reportId, 4, 4) AS UNSIGNED),
       MAX(CAST(SUBSTRING_INDEX(reportId, '-', -1) AS UNSIGNED))
FROM equipment_technician_reports
WHERE reportId REGEXP '^TM-[0-9]{4}-[0-9]{4}$'
GROUP BY CAST(SUBSTRING(reportId, 4, 4) AS UNSIGNED)
ON DUPLICATE KEY UPDATE lastNumber = GREATEST(lastNumber, VALUES(lastNumber));
