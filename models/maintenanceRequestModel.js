/*
    MIT License
    
    Copyright (c) 2025 Christian I. Cabrera || XianFire Framework
    Mindoro State University - Philippines

    Permission is hereby granted, free of charge, to any person obtaining a copy
    of this software and associated documentation files (the "Software"), to deal
    in the Software without restriction, including without limitation the rights
    to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
    copies of the Software, and to permit persons to whom the Software is
    furnished to do so, subject to the following conditions:

    The above copyright notice and this permission notice shall be included in all
    copies or substantial portions of the Software.

    THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
    IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
    FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
    AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
    LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
    OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
    SOFTWARE.
*/

import { DataTypes } from "sequelize";
import { sequelize } from "./db.js";
import { User } from "./userModel.js";
import { Equipment } from "./equipmentModel.js";

export const MaintenanceRequest = sequelize.define("MaintenanceRequest", {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
    allowNull: false
  },
  student_id: {
    type: DataTypes.INTEGER,
    allowNull: true
  },
  student_name: {
    type: DataTypes.STRING,
    allowNull: true
  },
  equipment_id: {
    type: DataTypes.STRING,
    allowNull: true
  },
  laboratory_id: {
    type: DataTypes.INTEGER,
    allowNull: true
  },
  subject_id: {
    type: DataTypes.INTEGER,
    allowNull: true
  },
  instructor_id: {
    type: DataTypes.INTEGER,
    allowNull: true
  },
  laboratory_room: {
    type: DataTypes.STRING,
    allowNull: true
  },
  subject: {
    type: DataTypes.STRING,
    allowNull: true
  },
  instructor: {
    type: DataTypes.STRING,
    allowNull: true
  },
  equipmentId: {
    type: DataTypes.STRING,
    allowNull: true
  },
  serialNumber: {
    type: DataTypes.STRING(100),
    allowNull: true,
    comment: "Serial number of the equipment tied to this maintenance record"
  },
  computerLabId: {
    type: DataTypes.INTEGER,
    allowNull: true,
    comment: "Computer lab where the reported equipment was located"
  },
  campus: {
    type: DataTypes.STRING,
    allowNull: true
  },
  reportedBy: {
    type: DataTypes.INTEGER,
    allowNull: true
  },
  assignedTo: {
    type: DataTypes.INTEGER,
    allowNull: true
  },
  issueTitle: {
    type: DataTypes.STRING,
    allowNull: true
  },
  description: {
    type: DataTypes.TEXT,
    allowNull: false
  },
  category: {
    type: DataTypes.STRING,
    allowNull: true
  },
  priority: {
    type: DataTypes.ENUM("Low", "Medium", "High", "Critical"),
    allowNull: false,
    defaultValue: "Medium"
  },
  status: {
    type: DataTypes.STRING,
    allowNull: false,
    defaultValue: "Pending"
  },
  technicianNotes: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  resolvedBy: {
    type: DataTypes.STRING,
    allowNull: true
  },
  dateReported: {
    type: DataTypes.DATE,
    allowNull: true
  },
  dateResolved: {
    type: DataTypes.DATE,
    allowNull: true
  }
}, {
  timestamps: true,
  createdAt: "created_at",
  updatedAt: "updated_at",
  tableName: "maintenance_requests"
});

MaintenanceRequest.belongsTo(User, {
  foreignKey: "reportedBy",
  as: "reporter"
});

MaintenanceRequest.belongsTo(User, {
  foreignKey: "assignedTo",
  as: "technician"
});

MaintenanceRequest.belongsTo(Equipment, {
  foreignKey: {
    name: "equipmentId",
    allowNull: true
  },
  targetKey: "equipmentId",
  as: "equipment",
  constraints: false
});

export { sequelize };
