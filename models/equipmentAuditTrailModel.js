import { DataTypes } from 'sequelize';
import { sequelize } from './db.js';

/**
 * EquipmentAuditTrail Model
 * Complete audit log of all equipment-related actions
 * Provides accountability and history for compliance
 */
const EquipmentAuditTrail = sequelize.define('EquipmentAuditTrail', {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    equipmentId: {
        type: DataTypes.INTEGER,
        allowNull: true,
        comment: 'Equipment affected by this action'
    },
    serialNumber: {
        type: DataTypes.STRING(100),
        allowNull: true,
        comment: 'Serial number for quick reference'
    },
    actionType: {
        type: DataTypes.ENUM(
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
        ),
        allowNull: false
    },
    actionDescription: {
        type: DataTypes.TEXT,
        allowNull: true,
        comment: 'Human-readable description of the action'
    },
    performedBy: {
        type: DataTypes.INTEGER,
        allowNull: false,
        comment: 'User who performed the action'
    },
    performedByName: {
        type: DataTypes.STRING(255),
        allowNull: true,
        comment: 'Cached username for reports'
    },
    userRole: {
        type: DataTypes.ENUM('student', 'faculty', 'technician', 'admin'),
        allowNull: true,
        comment: 'Role at time of action'
    },
    campusId: {
        type: DataTypes.INTEGER,
        allowNull: true
    },
    beforeState: {
        type: DataTypes.JSON,
        allowNull: true,
        comment: 'Equipment state before action (JSON)'
    },
    afterState: {
        type: DataTypes.JSON,
        allowNull: true,
        comment: 'Equipment state after action (JSON)'
    },
    ipAddress: {
        type: DataTypes.STRING(45),
        allowNull: true,
        comment: 'IP address of user'
    },
    userAgent: {
        type: DataTypes.TEXT,
        allowNull: true,
        comment: 'Browser/client info'
    },
    actionTimestamp: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW,
        allowNull: false
    }
}, {
    tableName: 'equipment_audit_trail',
    timestamps: false,
    indexes: [
        { fields: ['equipmentId'] },
        { fields: ['serialNumber'] },
        { fields: ['actionType'] },
        { fields: ['performedBy'] },
        { fields: ['campusId'] },
        { fields: ['actionTimestamp'] }
    ]
});

export default EquipmentAuditTrail;
