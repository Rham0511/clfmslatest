import { DataTypes } from "sequelize";
import { sequelize } from "./db.js";

export const BorrowRecord = sequelize.define("BorrowRecord", {
  id: {
    type: DataTypes.STRING,
    primaryKey: true,
    allowNull: false
  },
  borrowerName: {
    type: DataTypes.STRING,
    allowNull: false
  },
  borrowerType: {
    type: DataTypes.STRING,
    allowNull: false,
    defaultValue: "Student"
  },
  departmentInfo: {
    type: DataTypes.STRING,
    allowNull: true
  },
  instructorName: {
    type: DataTypes.STRING,
    field: "instructor_name",
    allowNull: true
  },
  equipmentId: {
    type: DataTypes.STRING,
    allowNull: false
  },
  equipmentRecordId: {
    type: DataTypes.INTEGER,
    field: "equipment_record_id",
    allowNull: true
  },
  serialNumber: {
    type: DataTypes.STRING,
    field: "serialNumber",
    allowNull: true
  },
  equipmentName: {
    type: DataTypes.STRING,
    allowNull: false
  },
  campus: {
    type: DataTypes.STRING,
    allowNull: true
  },
  quantity: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 1
  },
  borrowDate: {
    type: DataTypes.DATEONLY,
    allowNull: false
  },
  borrowStartTime: {
    type: DataTypes.STRING,
    allowNull: true
  },
  expectedReturnDate: {
    type: DataTypes.DATEONLY,
    allowNull: true
  },
  expectedReturnTime: {
    type: DataTypes.STRING,
    allowNull: true
  },
  purpose: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  status: {
    type: DataTypes.STRING,
    allowNull: false,
    defaultValue: "Borrowed"
  },
  returnDate: {
    type: DataTypes.DATEONLY,
    allowNull: true
  },
  returnTime: {
    type: DataTypes.STRING,
    field: "returnTime",
    allowNull: true
  },
  condition: {
    type: DataTypes.STRING,
    allowNull: true
  },
  remarks: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  processedBy: {
    type: DataTypes.STRING,
    allowNull: true
  }
}, {
  timestamps: true,
  createdAt: "created_at",
  updatedAt: "updated_at",
  tableName: "borrow_records"
});

export const BorrowHistory = sequelize.define("BorrowHistory", {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
    allowNull: false
  },
  recordId: {
    type: DataTypes.STRING,
    allowNull: false
  },
  borrowerName: {
    type: DataTypes.STRING,
    allowNull: false
  },
  equipmentId: {
    type: DataTypes.STRING,
    allowNull: false
  },
  equipmentRecordId: {
    type: DataTypes.INTEGER,
    field: "equipment_record_id",
    allowNull: true
  },
  serialNumber: {
    type: DataTypes.STRING,
    field: "serialNumber",
    allowNull: true
  },
  equipmentName: {
    type: DataTypes.STRING,
    allowNull: false
  },
  borrowDate: {
    type: DataTypes.DATEONLY,
    allowNull: false
  },
  borrowStartTime: {
    type: DataTypes.STRING,
    allowNull: true
  },
  returnDate: {
    type: DataTypes.DATEONLY,
    allowNull: true
  },
  returnTime: {
    type: DataTypes.STRING,
    field: "returnTime",
    allowNull: true
  },
  expectedReturnTime: {
    type: DataTypes.STRING,
    allowNull: true
  },
  condition: {
    type: DataTypes.STRING,
    allowNull: true
  },
  purpose: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  remarks: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  processedBy: {
    type: DataTypes.STRING,
    allowNull: true
  },
  eventType: {
    type: DataTypes.STRING,
    allowNull: false,
    defaultValue: "borrowed"
  }
}, {
  timestamps: true,
  createdAt: "created_at",
  updatedAt: "updated_at",
  tableName: "borrow_histories"
});

export { sequelize };