import { DataTypes } from 'sequelize';
import { sequelize } from './db.js';

/**
 * EquipmentUsageLog Model
 * Tracks who used what equipment and when
 * Linked to attendance system for complete accountability
 */
const EquipmentUsageLog = sequelize.define('EquipmentUsageLog', {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    attendanceId: {
        type: DataTypes.INTEGER,
        allowNull: true,
        comment: 'Links to attendance record'
    },
    equipmentId: {
        type: DataTypes.INTEGER,
        allowNull: true,
        comment: 'Equipment being used'
    },
    serialNumber: {
        type: DataTypes.STRING(100),
        allowNull: true,
        comment: 'Serial number for quick reference'
    },
    userId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        comment: 'Student/user using the equipment'
    },
    campusId: {
        type: DataTypes.STRING(255),
        allowNull: true
    },
    laboratoryId: {
        type: DataTypes.STRING(255),
        allowNull: true
    },
    pcSetId: {
        type: DataTypes.STRING(50),
        allowNull: true,
        comment: 'PC set used during this session'
    },
    usageStartTime: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW,
        allowNull: false
    },
    usageEndTime: {
        type: DataTypes.DATE,
        allowNull: true
    },
    durationMinutes: {
        type: DataTypes.INTEGER,
        allowNull: true,
        comment: 'Auto-calculated usage duration'
    },
    sessionNotes: {
        type: DataTypes.TEXT,
        allowNull: true,
        comment: 'Notes about this usage session'
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
    tableName: 'equipment_usage_logs',
    timestamps: true,
    indexes: [
        { fields: ['attendanceId'] },
        { fields: ['equipmentId'] },
        { fields: ['serialNumber'] },
        { fields: ['userId'] },
        { fields: ['campusId'] },
        { fields: ['usageStartTime'] }
    ]
});

export default EquipmentUsageLog;
