-- Apply this migration to the application database before deploying QR issue reports.
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
    'equipment_scanned',
    'equipment_issue_reported'
  ) NOT NULL;
