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

export const Equipment = sequelize.define("Equipment", {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true,
    allowNull: false
  },
  equipmentId: {
    type: DataTypes.STRING,
    allowNull: false
  },
  name: {
    type: DataTypes.STRING,
    allowNull: false
  },
  assetNumber: {
    type: DataTypes.STRING,
    allowNull: true
  },
  category: {
    type: DataTypes.STRING,
    allowNull: false
  },
  campus: {
    type: DataTypes.STRING,
    allowNull: false
  },
  laboratoryRoom: {
    type: DataTypes.STRING,
    allowNull: true
  },
  computerLabId: {
    type: DataTypes.INTEGER,
    allowNull: true
  },
  qrCode: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  qrImage: {
    type: DataTypes.TEXT('long'),
    allowNull: true
  },
  qrGeneratedAt: {
    type: DataTypes.DATE,
    allowNull: true
  },
  status: {
    type: DataTypes.ENUM("Serviceable", "Unserviceable", "Lost", "Missing", "Under Maintenance", "In Use", "For Repair", "For Disposal"),
    allowNull: false,
    defaultValue: "Serviceable"
  },
  quantity: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 1
  },
  dateAdded: {
    type: DataTypes.DATEONLY,
    allowNull: false,
    defaultValue: DataTypes.NOW
  },
  // NEW FIELDS - Equipment Management Enhancements
  serialNumber: {
    type: DataTypes.STRING(100),
    allowNull: true,
    unique: true,
    comment: 'Unique serial number for equipment identification'
  },
  setId: {
    type: DataTypes.STRING(50),
    allowNull: true,
    comment: 'Groups equipment into sets (e.g., PC-SET-001)'
  },
  manufacturer: {
    type: DataTypes.STRING(100),
    allowNull: true,
    comment: 'Equipment manufacturer'
  },
  model: {
    type: DataTypes.STRING(100),
    allowNull: true,
    comment: 'Equipment model number'
  },
  purchaseDate: {
    type: DataTypes.DATEONLY,
    allowNull: true,
    comment: 'Date equipment was purchased'
  },
  warrantyExpiry: {
    type: DataTypes.DATEONLY,
    allowNull: true,
    comment: 'Warranty expiration date'
  },
  condition: {
    type: DataTypes.ENUM('excellent', 'good', 'fair', 'poor', 'broken'),
    defaultValue: 'good',
    allowNull: true,
    comment: 'Current physical condition'
  },
  location: {
    type: DataTypes.STRING(255),
    allowNull: true,
    comment: 'Current physical location in lab'
  },
  remarks: {
    type: DataTypes.TEXT,
    allowNull: true,
    comment: 'Additional notes about the equipment'
  },
  // MISSING EQUIPMENT TRACKING
  missingReportedAt: {
    type: DataTypes.DATE,
    allowNull: true,
    comment: 'When equipment was reported missing'
  },
  missingReportedBy: {
    type: DataTypes.INTEGER,
    allowNull: true,
    comment: 'User ID who reported it missing'
  },
  missingReason: {
    type: DataTypes.TEXT,
    allowNull: true,
    comment: 'Reason/notes for missing report'
  },
  foundAt: {
    type: DataTypes.DATE,
    allowNull: true,
    comment: 'When missing equipment was marked as found'
  },
  foundBy: {
    type: DataTypes.INTEGER,
    allowNull: true,
    comment: 'User ID who marked it as found'
  }
}, {
  timestamps: false,
  tableName: "equipment",
  indexes: [
    {
      unique: true,
      fields: ["campus", "category", "equipmentId"],
      name: "equipment_campus_category_id_unique"
    },
    { fields: ["setId"], name: "idx_setId" },
    { fields: ["status"], name: "idx_status" },
    { fields: ["missingReportedAt"], name: "idx_missingReportedAt" }
  ]
});

export const EquipmentSequence = sequelize.define("EquipmentSequence", {
  prefix: {
    type: DataTypes.STRING,
    allowNull: false,
    primaryKey: true,
    unique: true
  },
  lastNumber: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0
  }
}, {
  timestamps: false,
  tableName: "equipment_sequences"
});

export const EquipmentCategory = sequelize.define("EquipmentCategory", {
  name: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true
  },
  prefix: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true
  }
}, {
  timestamps: false,
  tableName: "equipment_categories"
});

export { sequelize };
