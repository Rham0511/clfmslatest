import { DataTypes } from 'sequelize';
import { sequelize } from './db.js';

/**
 * EquipmentInventoryCheck Model
 * Weekly inventory check sessions
 * Tracks physical verification of equipment presence and condition
 */
const EquipmentInventoryCheck = sequelize.define('EquipmentInventoryCheck', {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    checkId: {
        type: DataTypes.STRING(50),
        allowNull: false,
        unique: true,
        comment: 'Unique check identifier (e.g., INV-2026-W40)'
    },
    checkDate: {
        type: DataTypes.DATEONLY,
        allowNull: false,
        comment: 'Date of inventory check'
    },
    campusId: {
        type: DataTypes.STRING(255),
        allowNull: false
    },
    laboratoryId: {
        type: DataTypes.INTEGER,
        allowNull: true,
        comment: 'Specific lab or NULL for entire campus'
    },
    computerLabId: {
        type: DataTypes.INTEGER,
        allowNull: true,
        field: 'computerLabId'
    },
    performedBy: {
        type: DataTypes.INTEGER,
        allowNull: false,
        comment: 'Technician/admin who performed check'
    },
    performedByName: {
        type: DataTypes.STRING(255),
        allowNull: true,
        comment: 'Cached username'
    },
    status: {
        type: DataTypes.ENUM('in_progress', 'completed', 'reviewed'),
        defaultValue: 'in_progress',
        allowNull: false
    },
    totalItemsExpected: {
        type: DataTypes.INTEGER,
        allowNull: true,
        comment: 'Number of items that should be present'
    },
    totalItemsFound: {
        type: DataTypes.INTEGER,
        allowNull: true,
        comment: 'Number of items actually found'
    },
    missingCount: {
        type: DataTypes.INTEGER,
        defaultValue: 0
    },
    damagedCount: {
        type: DataTypes.INTEGER,
        defaultValue: 0
    },
    notes: {
        type: DataTypes.TEXT,
        allowNull: true,
        comment: 'General notes about this inventory check'
    },
    completedAt: {
        type: DataTypes.DATE,
        allowNull: true
    },
    reviewedBy: {
        type: DataTypes.INTEGER,
        allowNull: true,
        comment: 'Admin who reviewed this check'
    },
    reviewedAt: {
        type: DataTypes.DATE,
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
    tableName: 'equipment_inventory_checks',
    timestamps: true,
    indexes: [
        { fields: ['checkId'] },
        { fields: ['checkDate'] },
        { fields: ['campusId'] },
        { fields: ['laboratoryId'] },
        { fields: ['performedBy'] },
        { fields: ['status'] }
    ]
});

export default EquipmentInventoryCheck;
