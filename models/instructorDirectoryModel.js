import { DataTypes } from "sequelize";
import { sequelize } from "./db.js";

const DEFAULT_INSTRUCTORS = [
  "Glenda P. Binay",
  "Sheryl Lainez",
  "Nico A. Magnaye",
  "Uriel Melendrez",
  "Christian Cabrera"
];

export const InstructorDirectory = sequelize.define("InstructorDirectory", {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  name: {
    type: DataTypes.STRING(120),
    allowNull: false,
    unique: true
  }
}, {
  tableName: "instructor_directory",
  timestamps: true
});

export const ensureInstructorDirectoryTable = async () => {
  await InstructorDirectory.sync({ alter: false, logging: false });
  await InstructorDirectory.bulkCreate(
    DEFAULT_INSTRUCTORS.map((name) => ({ name })),
    { ignoreDuplicates: true, logging: false }
  );
};
