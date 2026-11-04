import { sequelize } from "./db.js";

export const ensurePCStationSessionsTable = async () => {
  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS pc_station_sessions (
      setId VARCHAR(50) NOT NULL,
      activeUserId INT NULL,
      startedAt DATETIME NULL,
      updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (setId),
      INDEX idx_pc_station_sessions_active_user (activeUserId)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
};

export const ensurePCStationAutoLogoutColumn = async () => {
  await ensurePCStationSessionsTable();
  const [columns] = await sequelize.query("SHOW COLUMNS FROM pc_station_sessions LIKE 'autoLogoutAt'");
  if (!columns.length) {
    await sequelize.query("ALTER TABLE pc_station_sessions ADD COLUMN autoLogoutAt DATETIME NULL");
  }
  return true;
};
