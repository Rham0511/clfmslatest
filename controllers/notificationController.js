import { Op } from "sequelize";
import { User } from "../models/userModel.js";
import { UserNotification, ensureUserNotificationTable } from "../models/userNotificationModel.js";
import { getNotificationSourceKey, syncCurrentUserNotifications } from "../utils/userNotifications.js";

function getUserId(req) {
  const userId = Number(req.session?.userId);
  return Number.isInteger(userId) && userId > 0 ? userId : null;
}

export const listUserNotifications = async (req, res) => {
  const userId = getUserId(req);
  if (!userId) return res.status(401).json({ error: "Please log in to view notifications." });

  try {
    await ensureUserNotificationTable();
    const user = await User.findByPk(userId, { attributes: ["id", "role", "campus"] });
    if (!user) return res.status(401).json({ error: "Please log in to view notifications." });
    await syncCurrentUserNotifications(user);
    const visibleWhere = { recipientUserId: userId, hiddenAt: null, deletedAt: null };
    const [notifications, unreadCount, totalCount] = await Promise.all([
      UserNotification.findAll({
        where: visibleWhere,
        order: [["id", "DESC"], ["created_at", "DESC"]],
        limit: 50,
        attributes: ["id", "type", "title", "message", "targetUrl", "campus", "readAt", "created_at"]
      }),
      UserNotification.count({ where: { ...visibleWhere, readAt: null } }),
      UserNotification.count({ where: visibleWhere })
    ]);

    return res.json({
      notifications: notifications.map((notification) => ({
        id: String(notification.id),
        type: notification.type,
        title: notification.title,
        message: notification.message,
        targetUrl: notification.targetUrl,
        campus: notification.campus,
        readAt: notification.readAt,
        createdAt: notification.created_at
      })),
      unreadCount,
      totalCount
    });
  } catch (error) {
    console.error("Failed to load user notifications.", error);
    return res.status(500).json({ error: "Failed to load notifications." });
  }
};

export const markUserNotificationRead = async (req, res) => {
  const userId = getUserId(req);
  if (!userId) return res.status(401).json({ error: "Please log in to update notifications." });
  const notificationId = String(req.params.id || "").trim();
  if (!/^\d+$/.test(notificationId)) return res.status(400).json({ error: "Invalid notification ID." });

  try {
    await ensureUserNotificationTable();
    const [updatedCount] = await UserNotification.update(
      { readAt: new Date() },
      { where: { id: notificationId, recipientUserId: userId, readAt: null, hiddenAt: null, deletedAt: null } }
    );
    if (!updatedCount) {
      const notification = await UserNotification.findOne({
        where: { id: notificationId, recipientUserId: userId, hiddenAt: null, deletedAt: null },
        attributes: ["id"]
      });
      if (!notification) return res.status(404).json({ error: "Notification not found." });
    }
    return res.json({ success: true });
  } catch (error) {
    console.error("Failed to mark user notification as read.", error);
    return res.status(500).json({ error: "Failed to update notification." });
  }
};

export const markAllUserNotificationsRead = async (req, res) => {
  const userId = getUserId(req);
  if (!userId) return res.status(401).json({ error: "Please log in to update notifications." });

  try {
    await ensureUserNotificationTable();
    const [updatedCount] = await UserNotification.update(
      { readAt: new Date() },
      { where: { recipientUserId: userId, readAt: { [Op.is]: null }, hiddenAt: null, deletedAt: null } }
    );
    return res.json({ success: true, updatedCount });
  } catch (error) {
    console.error("Failed to mark all user notifications as read.", error);
    return res.status(500).json({ error: "Failed to update notifications." });
  }
};

export const hideUserNotification = async (req, res) => {
  const userId = getUserId(req);
  if (!userId) return res.status(401).json({ error: "Please log in to update notifications." });
  const notificationId = String(req.params.id || "").trim();
  if (!/^\d+$/.test(notificationId)) return res.status(400).json({ error: "Invalid notification ID." });

  try {
    await ensureUserNotificationTable();
    const [updatedCount] = await UserNotification.update(
      { hiddenAt: new Date(), readAt: new Date() },
      { where: { id: notificationId, recipientUserId: userId, hiddenAt: null, deletedAt: null } }
    );
    if (!updatedCount) {
      const notification = await UserNotification.findOne({
        where: { id: notificationId, recipientUserId: userId, deletedAt: null },
        attributes: ["id"]
      });
      if (!notification) return res.status(404).json({ error: "Notification not found." });
    }
    return res.json({ success: true });
  } catch (error) {
    console.error("Failed to hide user notification.", error);
    return res.status(500).json({ error: "Failed to hide notification." });
  }
};

export const muteUserNotification = async (req, res) => {
  const userId = getUserId(req);
  if (!userId) return res.status(401).json({ error: "Please log in to update notifications." });
  const notificationId = String(req.params.id || "").trim();
  if (!/^\d+$/.test(notificationId)) return res.status(400).json({ error: "Invalid notification ID." });

  try {
    await ensureUserNotificationTable();
    const notification = await UserNotification.findOne({
      where: { id: notificationId, recipientUserId: userId, deletedAt: null },
      attributes: ["id", "eventKey", "sourceKey", "type", "targetUrl"]
    });
    if (!notification) return res.status(404).json({ error: "Notification not found." });
    const sourceKey = notification.sourceKey
      || getNotificationSourceKey(notification.eventKey, notification.type, notification.targetUrl);
    const [updatedCount] = await UserNotification.update(
      { sourceKey, mutedAt: new Date(), hiddenAt: new Date(), readAt: new Date() },
      { where: { id: notificationId, recipientUserId: userId, deletedAt: null } }
    );
    if (!updatedCount) return res.status(404).json({ error: "Notification not found." });
    return res.json({ success: true });
  } catch (error) {
    console.error("Failed to mute user notification source.", error);
    return res.status(500).json({ error: "Failed to mute notification source." });
  }
};

export const deleteUserNotification = async (req, res) => {
  const userId = getUserId(req);
  if (!userId) return res.status(401).json({ error: "Please log in to update notifications." });
  const notificationId = String(req.params.id || "").trim();
  if (!/^\d+$/.test(notificationId)) return res.status(400).json({ error: "Invalid notification ID." });

  try {
    await ensureUserNotificationTable();
    const [updatedCount] = await UserNotification.update(
      { deletedAt: new Date(), readAt: new Date() },
      { where: { id: notificationId, recipientUserId: userId, deletedAt: null } }
    );
    if (!updatedCount) {
      const notification = await UserNotification.findOne({
        where: { id: notificationId, recipientUserId: userId },
        attributes: ["id", "deletedAt"]
      });
      if (!notification) return res.status(404).json({ error: "Notification not found." });
    }
    return res.json({ success: true });
  } catch (error) {
    console.error("Failed to delete user notification.", error);
    return res.status(500).json({ error: "Failed to delete notification." });
  }
};

export const clearUserNotifications = async (req, res) => {
  const userId = getUserId(req);
  if (!userId) return res.status(401).json({ error: "Please log in to update notifications." });

  try {
    await ensureUserNotificationTable();
    const [updatedCount] = await UserNotification.update(
      { hiddenAt: new Date(), readAt: new Date() },
      { where: { recipientUserId: userId, hiddenAt: null, deletedAt: null } }
    );
    return res.json({ success: true, updatedCount });
  } catch (error) {
    console.error("Failed to clear user notifications.", error);
    return res.status(500).json({ error: "Failed to clear notifications." });
  }
};
