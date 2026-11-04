import { DataTypes } from "sequelize";
import { sequelize } from "./db.js";

export const EquipmentAssignment = sequelize.define("EquipmentAssignment", {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
    allowNull: false
  },
  equipmentRecordId: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  facultyUserId: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  assignedByAdminId: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  unassignedByAdminId: {
    type: DataTypes.INTEGER,
    allowNull: true
  },
  assignedAt: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW
  },
  unassignedAt: {
    type: DataTypes.DATE,
    allowNull: true
  },
  remarks: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  unassignmentRemarks: {
    type: DataTypes.TEXT,
    allowNull: true
  }
}, {
  tableName: "equipment_assignments",
  timestamps: true,
  createdAt: "created_at",
  updatedAt: "updated_at",
  indexes: [
    { fields: ["equipmentRecordId"], name: "idx_equipment_assignment_equipment" },
    { fields: ["facultyUserId"], name: "idx_equipment_assignment_faculty" },
    { fields: ["unassignedAt"], name: "idx_equipment_assignment_active" }
  ]
});

export const ensureEquipmentAssignmentTable = async () => {
  try {
    await EquipmentAssignment.sync({ alter: false, logging: false });
    return true;
  } catch (error) {
    console.error("Failed to ensure equipment_assignments table exists:", error);
    throw error;
  }
};
