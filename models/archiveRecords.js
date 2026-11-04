import { QueryTypes } from "sequelize";
import { sequelize } from "./db.js";

let tableReady = false;

export async function ensureArchiveRecordsTable() {
  if (tableReady) return;

  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS archived_records (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      entityType VARCHAR(64) NOT NULL,
      entityId VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
      title VARCHAR(255) NOT NULL,
      details TEXT NULL,
      archivedBy INT NOT NULL,
      archivedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      parentEntityType VARCHAR(64) NULL,
      parentEntityId VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL,
      PRIMARY KEY (id),
      UNIQUE KEY uq_archived_record_entity (entityType, entityId),
      KEY idx_archived_records_archived_at (archivedAt)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  const [parentEntityTypeColumn] = await sequelize.query(
    "SHOW COLUMNS FROM archived_records LIKE 'parentEntityType'"
  );
  if (!parentEntityTypeColumn.length) {
    await sequelize.query("ALTER TABLE archived_records ADD COLUMN parentEntityType VARCHAR(64) NULL");
  }

  const [parentEntityIdColumn] = await sequelize.query(
    "SHOW COLUMNS FROM archived_records LIKE 'parentEntityId'"
  );
  if (!parentEntityIdColumn.length) {
    await sequelize.query(
      "ALTER TABLE archived_records ADD COLUMN parentEntityId VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL"
    );
  }

  tableReady = true;
}

export async function getArchivedEntityIds(entityType) {
  await ensureArchiveRecordsTable();
  const rows = await sequelize.query(
    "SELECT entityId FROM archived_records WHERE entityType = ?",
    { replacements: [entityType], type: QueryTypes.SELECT }
  );
  return rows.map(({ entityId }) => String(entityId));
}
