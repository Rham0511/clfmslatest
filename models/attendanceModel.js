import { DataTypes } from "sequelize";
import { sequelize } from "./db.js";

export const Attendance = sequelize.define("Attendance", {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  studentId: {
    type: DataTypes.STRING,
    allowNull: false
  },
  fullName: {
    type: DataTypes.STRING,
    allowNull: false
  },
  courseSection: {
    type: DataTypes.STRING,
    allowNull: false
  },
  subject: {
    type: DataTypes.STRING,
    allowNull: false
  },
  lab: {
    type: DataTypes.STRING,
    allowNull: false
  },
  instructor: {
    type: DataTypes.STRING,
    allowNull: false
  },
  date: {
    type: DataTypes.DATEONLY,
    allowNull: false
  },
  timeIn: {
    type: DataTypes.STRING,
    allowNull: false
  },
  status: {
    type: DataTypes.ENUM("Present", "Late", "Absent"),
    allowNull: false,
    defaultValue: "Present"
  },
  sessionToken: {
    type: DataTypes.STRING,
    allowNull: true
  },
  laboratoryScheduleId: {
    type: DataTypes.INTEGER,
    allowNull: true
  },
  pcStationSetId: {
    type: DataTypes.STRING(50),
    allowNull: true
  }
}, {
  timestamps: true,
  tableName: "attendance"
});

export const ensureAttendancePcStationColumn = async () => {
  const [columns] = await sequelize.query("SHOW COLUMNS FROM attendance LIKE 'pcStationSetId'");
  if (!columns.length) {
    await sequelize.query("ALTER TABLE attendance ADD COLUMN pcStationSetId VARCHAR(50) NULL");
  }
  return true;
};

export { sequelize };
