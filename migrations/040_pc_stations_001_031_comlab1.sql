-- PC stations 001 through 031 are physically assigned to ComLab 1.
-- PC stations numbered 032 and above retain their existing lab assignment.
UPDATE equipment_sets stationSet
INNER JOIN computer_labs currentLab ON currentLab.id = stationSet.computerLabId
INNER JOIN computer_labs lab
  ON BINARY lab.name = BINARY 'COMLAB 1'
  AND BINARY lab.campus = BINARY currentLab.campus
SET stationSet.location = 'COMLAB 1',
    stationSet.computerLabId = lab.id,
    stationSet.updatedAt = NOW()
WHERE stationSet.setId REGEXP '^PC-SET-[0-9]{3}$'
  AND CAST(SUBSTRING_INDEX(stationSet.setId, '-', -1) AS UNSIGNED) BETWEEN 1 AND 31;

UPDATE equipment equipmentItem
INNER JOIN equipment_sets stationSet
  ON BINARY stationSet.setId = BINARY equipmentItem.setId
INNER JOIN computer_labs lab
  ON BINARY lab.name = BINARY 'COMLAB 1'
  AND BINARY LOWER(TRIM(lab.campus)) = BINARY LOWER(TRIM(REPLACE(equipmentItem.campus, ' Campus', '')))
SET equipmentItem.computerLabId = lab.id,
    equipmentItem.laboratoryRoom = CONCAT(
      lab.name,
      IF(lab.roomNumber IS NULL OR TRIM(lab.roomNumber) = '', '', CONCAT(' — ', lab.roomNumber))
    )
WHERE stationSet.setId REGEXP '^PC-SET-[0-9]{3}$'
  AND CAST(SUBSTRING_INDEX(stationSet.setId, '-', -1) AS UNSIGNED) BETWEEN 1 AND 31;

UPDATE equipment_sets
SET setName = 'PC Station 031',
    updatedAt = NOW()
WHERE BINARY setId = BINARY 'PC-SET-031'
  AND BINARY setName = BINARY 'PC Station 003';
