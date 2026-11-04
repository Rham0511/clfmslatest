import { DataTypes } from "sequelize";
import { sequelize } from "./db.js";

export const LaboratorySchedule = sequelize.define("LaboratorySchedule", {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  subject: {
    type: DataTypes.STRING,
    allowNull: false
  },
  instructor: {
    type: DataTypes.STRING,
    allowNull: true
  },
  instructorUserId: {
    type: DataTypes.INTEGER,
    allowNull: true
  },
  yearLevel: {
    type: DataTypes.STRING(30),
    allowNull: true
  },
  section: {
    type: DataTypes.STRING(30),
    allowNull: true
  },
  laboratoryRoom: {
    type: DataTypes.STRING,
    allowNull: false
  },
  computerLabId: {
    type: DataTypes.INTEGER,
    allowNull: true
  },
  campus: {
    type: DataTypes.STRING,
    allowNull: false
  },
  createdBy: {
    type: DataTypes.INTEGER,
    allowNull: true
  },
  dayOfWeek: {
    type: DataTypes.STRING,
    allowNull: false
  },
  startTime: {
    type: DataTypes.STRING,
    allowNull: false
  },
  endTime: {
    type: DataTypes.STRING,
    allowNull: false
  },
  status: {
    type: DataTypes.STRING,
    allowNull: false,
    defaultValue: "Confirmed"
  },
  qrEnabled: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false
  },
  scheduleColor: {
    type: DataTypes.STRING(7),
    allowNull: false,
    defaultValue: "#16a34a"
  }
}, {
  tableName: "laboratory_schedules",
  timestamps: true
});

export { sequelize };
