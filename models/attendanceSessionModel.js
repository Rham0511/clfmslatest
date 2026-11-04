import { DataTypes } from "sequelize";
import { sequelize } from "./db.js";

export const AttendanceSession = sequelize.define("AttendanceSession", {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  token: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true
  },
  title: {
    type: DataTypes.STRING,
    allowNull: false
  },
  day: {
    type: DataTypes.STRING,
    allowNull: true
  },
  time: {
    type: DataTypes.STRING,
    allowNull: true
  },
  room: {
    type: DataTypes.STRING,
    allowNull: true
  },
  courseSection: {
    type: DataTypes.STRING,
    allowNull: true
  },
  status: {
    type: DataTypes.STRING,
    allowNull: true
  },
  laboratoryScheduleId: {
    type: DataTypes.INTEGER,
    allowNull: true
  },
  intendedStudentUserId: {
    type: DataTypes.INTEGER,
    allowNull: true
  },
  expiresAt: {
    type: DataTypes.DATE,
    allowNull: false
  }
}, {
  timestamps: true,
  tableName: "attendance_sessions"
});
