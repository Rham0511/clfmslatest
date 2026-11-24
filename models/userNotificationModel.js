import { DataTypes } from "sequelize";
import { sequelize } from "./db.js";

export const UserNotification = sequelize.define("UserNotification", {
  id: {
    type: DataTypes.BIGINT.UNSIGNED,
    primaryKey: true,
    autoIncrement: true,
    allowNull: false
  },
  recipientUserId: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  eventKey: {
    type: DataTypes.STRING(191),
    allowNull: false,
    unique: true
  },
  sourceKey: {
    type: DataTypes.STRING(191),
    allowNull: true
  },
  type: {
    type: DataTypes.STRING(48),
    allowNull: false
  },
  title: {
    type: DataTypes.STRING(160),
    allowNull: false
  },
  message: {
    type: DataTypes.TEXT,
    allowNull: false
  },
  targetUrl: {
    type: DataTypes.STRING(512),
    allowNull: false
  },
  campus: {
    type: DataTypes.STRING(120),
    allowNull: true
  },
  readAt: {
    type: DataTypes.DATE,
    allowNull: true
  },
  hiddenAt: {
    type: DataTypes.DATE,
    allowNull: true
  },
  deletedAt: {
    type: DataTypes.DATE,
    allowNull: true
  },
  mutedAt: {
    type: DataTypes.DATE,
    allowNull: true
  }
}, {
  tableName: "user_notifications",
  timestamps: true,
  createdAt: "created_at",
  updatedAt: "updated_at",
  indexes: [
    { fields: ["recipientUserId", "readAt", "created_at"], name: "idx_user_notifications_recipient_read_created" }
  ]
});

let ensureUserNotificationTablePromise = null;

export const ensureUserNotificationTable = async () => {
  if (!ensureUserNotificationTablePromise) {
    ensureUserNotificationTablePromise = (async () => {
      await UserNotification.sync({ alter: false, logging: false });
      const queryInterface = sequelize.getQueryInterface();
      const columns = await queryInterface.describeTable("user_notifications");
      for (const column of ["hiddenAt", "deletedAt", "sourceKey", "mutedAt"]) {
        if (!columns[column]) {
          await queryInterface.addColumn("user_notifications", column, {
            type: column === "sourceKey" ? DataTypes.STRING(191) : DataTypes.DATE,
            allowNull: true
          });
        }
      }
      return true;
    })().catch((error) => {
      ensureUserNotificationTablePromise = null;
      console.error("Failed to ensure user_notifications table exists.", error);
      throw error;
    });
  }
  return ensureUserNotificationTablePromise;
};
