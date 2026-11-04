UPDATE computer_labs
SET name = CONCAT('COMLAB ', SUBSTRING_INDEX(sourceKey, ' ', -1)),
    updatedAt = NOW()
WHERE sourceKey REGEXP '^legacy:computer lab [0-9]+$'
  AND name = CONCAT('Computer Lab ', SUBSTRING_INDEX(sourceKey, ' ', -1));

UPDATE equipment e
INNER JOIN computer_labs lab ON lab.id = e.computerLabId
SET e.laboratoryRoom = CONCAT(lab.name, IF(lab.roomNumber IS NULL OR TRIM(lab.roomNumber) = '', '', CONCAT(' — ', lab.roomNumber)));

UPDATE laboratory_schedules schedule
INNER JOIN computer_labs lab ON lab.id = schedule.computerLabId
SET schedule.laboratoryRoom = CONCAT(lab.name, IF(lab.roomNumber IS NULL OR TRIM(lab.roomNumber) = '', '', CONCAT(' — ', lab.roomNumber)));

UPDATE attendance_sessions attendanceSession
INNER JOIN computer_labs lab ON lab.id = attendanceSession.computerLabId
SET attendanceSession.room = CONCAT(lab.name, IF(lab.roomNumber IS NULL OR TRIM(lab.roomNumber) = '', '', CONCAT(' — ', lab.roomNumber)));

UPDATE attendance attendanceRecord
INNER JOIN computer_labs lab ON lab.id = attendanceRecord.computerLabId
SET attendanceRecord.lab = CONCAT(lab.name, IF(lab.roomNumber IS NULL OR TRIM(lab.roomNumber) = '', '', CONCAT(' — ', lab.roomNumber)));

UPDATE maintenance_requests request
INNER JOIN computer_labs lab ON lab.id = request.computerLabId
SET request.laboratory_room = CONCAT(lab.name, IF(lab.roomNumber IS NULL OR TRIM(lab.roomNumber) = '', '', CONCAT(' — ', lab.roomNumber)));

UPDATE missing_equipment_history history
INNER JOIN computer_labs lab ON lab.id = history.computerLabId
SET history.laboratoryRoom = CONCAT(lab.name, IF(lab.roomNumber IS NULL OR TRIM(lab.roomNumber) = '', '', CONCAT(' — ', lab.roomNumber)));

UPDATE equipment_usage_logs usageLog
INNER JOIN computer_labs lab ON lab.id = usageLog.computerLabId
SET usageLog.laboratoryId = CONCAT(lab.name, IF(lab.roomNumber IS NULL OR TRIM(lab.roomNumber) = '', '', CONCAT(' — ', lab.roomNumber)));

UPDATE equipment_inventory_check_items checkItem
INNER JOIN equipment equipmentItem ON equipmentItem.id = checkItem.equipmentId
INNER JOIN computer_labs lab ON lab.id = equipmentItem.computerLabId
SET checkItem.expectedLocation = CONCAT(lab.name, IF(lab.roomNumber IS NULL OR TRIM(lab.roomNumber) = '', '', CONCAT(' — ', lab.roomNumber))),
    checkItem.actualLocation = CASE
      WHEN checkItem.actualLocation IN ('Lab1', 'Lab2', 'COMLAB 1', 'COMLAB 2', 'Laboratory 1 — Room 202', 'Laboratory 2 — Room 204')
      THEN CONCAT(lab.name, IF(lab.roomNumber IS NULL OR TRIM(lab.roomNumber) = '', '', CONCAT(' — ', lab.roomNumber)))
      ELSE checkItem.actualLocation
    END;
