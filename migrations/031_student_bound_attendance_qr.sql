ALTER TABLE attendance_sessions
  ADD COLUMN intendedStudentUserId INT NULL,
  ADD INDEX idx_attendance_sessions_student_schedule_expiry
    (laboratoryScheduleId, intendedStudentUserId, expiresAt);
