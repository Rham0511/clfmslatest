import { DataTypes } from "sequelize";
import { sequelize } from "./db.js";

export const BorrowRequestAccountability = sequelize.define("BorrowRequestAccountability", {
  borrowRecordId: {
    type: DataTypes.STRING,
    primaryKey: true,
    allowNull: false
  },
  requesterUserId: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  accountableFacultyUserId: {
    type: DataTypes.INTEGER,
    allowNull: true
  },
  approvedByUserId: {
    type: DataTypes.INTEGER,
    allowNull: true
  },
  approvedAt: {
    type: DataTypes.DATE,
    allowNull: true
  },
  rejectionReason: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  approvalRequired: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false
  }
}, {
  tableName: "borrow_request_accountability",
  timestamps: true,
  createdAt: "created_at",
  updatedAt: "updated_at",
  indexes: [
    { fields: ["requesterUserId"], name: "idx_borrow_accountability_requester" },
    { fields: ["accountableFacultyUserId"], name: "idx_borrow_accountability_faculty" }
  ]
});

export const ensureBorrowRequestAccountabilityTable = async () => {
  try {
    await BorrowRequestAccountability.sync({ alter: false, logging: false });
    return true;
  } catch (error) {
    console.error("Failed to ensure borrow_request_accountability table exists:", error);
    throw error;
  }
};
