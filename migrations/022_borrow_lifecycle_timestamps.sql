ALTER TABLE borrow_records
  MODIFY COLUMN expectedReturnDate DATE NULL;

ALTER TABLE equipment_audit_trail
  MODIFY COLUMN actionType ENUM(
    'created',
    'updated',
    'deleted',
    'borrow_requested',
    'return_requested',
    'borrowed',
    'returned',
    'maintenance_started',
    'maintenance_completed',
    'status_changed',
    'condition_changed',
    'location_changed',
    'assigned_to_set',
    'removed_from_set'
  ) NOT NULL;
