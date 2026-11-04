ALTER TABLE equipment_audit_trail
  MODIFY COLUMN actionType ENUM(
    'created',
    'updated',
    'deleted',
    'borrow_requested',
    'return_requested',
    'borrowed',
    'returned',
    'accountability_assigned',
    'accountability_removed',
    'maintenance_started',
    'maintenance_completed',
    'status_changed',
    'condition_changed',
    'location_changed',
    'assigned_to_set',
    'removed_from_set',
    'equipment_scanned'
  ) NOT NULL;

INSERT INTO equipment_audit_trail (
  equipmentId,
  serialNumber,
  actionType,
  actionDescription,
  performedBy,
  performedByName,
  userRole,
  campusId,
  beforeState,
  afterState,
  actionTimestamp
)
SELECT
  e.id,
  e.serialNumber,
  'accountability_assigned',
  CONCAT(
    e.equipmentId,
    ' (',
    e.name,
    ') was assigned to ',
    COALESCE(f.name, CONCAT('Faculty account #', assignment.facultyUserId)),
    IF(f.email IS NULL OR f.email = '', '', CONCAT(' (', f.email, ')')),
    '.'
  ),
  assignment.assignedByAdminId,
  assigningAdmin.name,
  'admin',
  NULL,
  NULL,
  JSON_OBJECT(
    'accountableFaculty',
    JSON_OBJECT('id', f.id, 'name', f.name, 'email', f.email),
    'assignmentId',
    assignment.id,
    'remarks',
    assignment.remarks
  ),
  assignment.assignedAt
FROM equipment_assignments AS assignment
JOIN equipment AS e ON e.id = assignment.equipmentRecordId
LEFT JOIN users AS f ON f.id = assignment.facultyUserId
LEFT JOIN users AS assigningAdmin ON assigningAdmin.id = assignment.assignedByAdminId
WHERE NOT EXISTS (
  SELECT 1
  FROM equipment_audit_trail AS existing
  WHERE existing.equipmentId = assignment.equipmentRecordId
    AND existing.actionType = 'accountability_assigned'
    AND JSON_UNQUOTE(JSON_EXTRACT(existing.afterState, '$.assignmentId')) = CAST(assignment.id AS CHAR)
);

INSERT INTO equipment_audit_trail (
  equipmentId,
  serialNumber,
  actionType,
  actionDescription,
  performedBy,
  performedByName,
  userRole,
  campusId,
  beforeState,
  afterState,
  actionTimestamp
)
SELECT
  e.id,
  e.serialNumber,
  'accountability_removed',
  CONCAT(
    e.equipmentId,
    ' (',
    e.name,
    ') accountability was removed from ',
    COALESCE(f.name, CONCAT('Faculty account #', assignment.facultyUserId)),
    IF(f.email IS NULL OR f.email = '', '', CONCAT(' (', f.email, ')')),
    '.'
  ),
  assignment.unassignedByAdminId,
  removingAdmin.name,
  'admin',
  NULL,
  JSON_OBJECT(
    'accountableFaculty',
    JSON_OBJECT('id', f.id, 'name', f.name, 'email', f.email),
    'assignmentId',
    assignment.id
  ),
  JSON_OBJECT('accountableFaculty', NULL, 'assignmentId', assignment.id, 'remarks', assignment.unassignmentRemarks),
  assignment.unassignedAt
FROM equipment_assignments AS assignment
JOIN equipment AS e ON e.id = assignment.equipmentRecordId
LEFT JOIN users AS f ON f.id = assignment.facultyUserId
LEFT JOIN users AS removingAdmin ON removingAdmin.id = assignment.unassignedByAdminId
WHERE assignment.unassignedAt IS NOT NULL
  AND assignment.unassignedByAdminId IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM equipment_audit_trail AS existing
    WHERE existing.equipmentId = assignment.equipmentRecordId
      AND existing.actionType = 'accountability_removed'
      AND JSON_UNQUOTE(JSON_EXTRACT(existing.beforeState, '$.assignmentId')) = CAST(assignment.id AS CHAR)
  );
