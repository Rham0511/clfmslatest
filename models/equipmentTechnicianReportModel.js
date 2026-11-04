import { DataTypes, QueryTypes } from 'sequelize';
import { sequelize } from './db.js';

/**
 * EquipmentTechnicianReport Model
 * Weekly reports submitted by technicians
 * Summarizes equipment status, maintenance, and issues
 */
const EquipmentTechnicianReport = sequelize.define('EquipmentTechnicianReport', {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    reportId: {
        type: DataTypes.STRING(50),
        allowNull: false,
        unique: true,
        comment: 'Unique report identifier (maintenance format: TM-2026-0001)'
    },
    reportDate: {
        type: DataTypes.DATEONLY,
        allowNull: false,
        comment: 'Date report covers'
    },
    weekNumber: {
        type: DataTypes.INTEGER,
        allowNull: true,
        comment: 'Week number of year'
    },
    campusId: {
        type: DataTypes.STRING(255),
        allowNull: true
    },
    laboratoryId: {
        type: DataTypes.INTEGER,
        allowNull: true,
        comment: 'Specific lab or NULL for entire campus'
    },
    technicianId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        comment: 'Technician who created report'
    },
    technicianName: {
        type: DataTypes.STRING(255),
        allowNull: true,
        comment: 'Cached technician name'
    },
    equipmentId: {
        type: DataTypes.INTEGER,
        allowNull: true,
        comment: 'Equipment involved in an incident or maintenance report'
    },
    serialNumber: {
        type: DataTypes.STRING(100),
        allowNull: true,
        comment: 'Serial number snapshot for traceability'
    },
    issueType: {
        type: DataTypes.STRING(50),
        allowNull: true,
        comment: 'borrowed, damaged, problem, missing, or repair'
    },
    reportType: {
        type: DataTypes.ENUM('weekly', 'incident', 'maintenance', 'audit'),
        defaultValue: 'weekly'
    },
    summary: {
        type: DataTypes.TEXT,
        allowNull: true,
        comment: 'Executive summary of the report'
    },
    equipmentIssuesCount: {
        type: DataTypes.INTEGER,
        defaultValue: 0
    },
    maintenancePerformed: {
        type: DataTypes.INTEGER,
        defaultValue: 0
    },
    newEquipmentAdded: {
        type: DataTypes.INTEGER,
        defaultValue: 0
    },
    equipmentRetired: {
        type: DataTypes.INTEGER,
        defaultValue: 0
    },
    inventoryCheckCompleted: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    },
    inventoryCheckId: {
        type: DataTypes.INTEGER,
        allowNull: true,
        comment: 'Links to inventory check if performed'
    },
    recommendations: {
        type: DataTypes.TEXT,
        allowNull: true,
        comment: 'Technician recommendations'
    },
    attachments: {
        type: DataTypes.JSON,
        allowNull: true,
        comment: 'File paths or URLs to attachments'
    },
    status: {
        type: DataTypes.ENUM('draft', 'submitted', 'reviewed', 'approved'),
        defaultValue: 'draft'
    },
    submittedAt: {
        type: DataTypes.DATE,
        allowNull: true
    },
    reviewedBy: {
        type: DataTypes.INTEGER,
        allowNull: true,
        comment: 'Admin who reviewed'
    },
    reviewedAt: {
        type: DataTypes.DATE,
        allowNull: true
    },
    reviewComments: {
        type: DataTypes.TEXT,
        allowNull: true
    },
    createdAt: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW
    },
    updatedAt: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW
    }
}, {
    tableName: 'equipment_technician_reports',
    timestamps: true,
    indexes: [
        { fields: ['reportId'] },
        { fields: ['reportDate'] },
        { fields: ['weekNumber'] },
        { fields: ['campusId'] },
        { fields: ['technicianId'] },
        { fields: ['reportType'] },
        { fields: ['status'] }
    ]
});

let legacyMaintenanceMigrationPromise = null;

export async function ensureTechnicianReportSequenceTable() {
    await sequelize.query(`
        CREATE TABLE IF NOT EXISTS technician_report_sequences (
            reportYear SMALLINT UNSIGNED NOT NULL PRIMARY KEY,
            lastNumber INT UNSIGNED NOT NULL DEFAULT 0,
            updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    await sequelize.query(`
        INSERT INTO technician_report_sequences (reportYear, lastNumber)
        SELECT CAST(SUBSTRING(reportId, 4, 4) AS UNSIGNED),
               MAX(CAST(SUBSTRING_INDEX(reportId, '-', -1) AS UNSIGNED))
        FROM equipment_technician_reports
        WHERE reportId REGEXP '^TM-[0-9]{4}-[0-9]{4}$'
        GROUP BY CAST(SUBSTRING(reportId, 4, 4) AS UNSIGNED)
        ON DUPLICATE KEY UPDATE lastNumber = GREATEST(lastNumber, VALUES(lastNumber))
    `);

    if (!legacyMaintenanceMigrationPromise) {
        legacyMaintenanceMigrationPromise = sequelize.transaction(async (transaction) => {
            const legacyReports = await sequelize.query(`
                SELECT id, reportDate
                FROM equipment_technician_reports
                WHERE reportType = 'maintenance'
                  AND reportId REGEXP '^TECH-MAINTENANCE-[0-9]+$'
                ORDER BY reportDate ASC, createdAt ASC, id ASC
                FOR UPDATE
            `, { type: QueryTypes.SELECT, transaction });

            for (const report of legacyReports) {
                const year = Number(String(report.reportDate || '').slice(0, 4));
                if (!Number.isInteger(year) || year < 1000 || year > 9999) continue;
                await sequelize.query(
                    `INSERT INTO technician_report_sequences (reportYear, lastNumber) VALUES (?, 0)
                     ON DUPLICATE KEY UPDATE reportYear = VALUES(reportYear)`,
                    { replacements: [year], transaction }
                );
                const sequences = await sequelize.query(
                    'SELECT lastNumber FROM technician_report_sequences WHERE reportYear = ? FOR UPDATE',
                    { replacements: [year], type: QueryTypes.SELECT, transaction }
                );
                const nextNumber = Number(sequences[0]?.lastNumber || 0) + 1;
                const reportId = `TM-${year}-${String(nextNumber).padStart(4, '0')}`;
                await sequelize.query(
                    'UPDATE technician_report_sequences SET lastNumber = ? WHERE reportYear = ?',
                    { replacements: [nextNumber, year], transaction }
                );
                await sequelize.query(
                    'UPDATE equipment_technician_reports SET reportId = ? WHERE id = ?',
                    { replacements: [reportId, report.id], transaction }
                );
            }
        }).catch((error) => {
            legacyMaintenanceMigrationPromise = null;
            throw error;
        });
    }
    await legacyMaintenanceMigrationPromise;
}

export default EquipmentTechnicianReport;
