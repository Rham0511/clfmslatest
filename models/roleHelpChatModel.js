import { sequelize } from "./db.js";

let tablesReadyPromise = null;

export const ensureRoleHelpChatTables = async () => {
  if (!tablesReadyPromise) {
    tablesReadyPromise = (async () => {
      await sequelize.query(`
        CREATE TABLE IF NOT EXISTS role_help_chats (
          id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
          userId INT NOT NULL,
          title VARCHAR(120) NOT NULL DEFAULT 'New chat',
          createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          PRIMARY KEY (id),
          KEY role_help_chats_user_updated (userId, updatedAt, id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
      await sequelize.query(`
        CREATE TABLE IF NOT EXISTS role_help_chat_messages (
          id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
          chatId BIGINT UNSIGNED NOT NULL,
          sender ENUM('user', 'assistant') NOT NULL,
          content TEXT NOT NULL,
          createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (id),
          KEY role_help_chat_messages_chat_id (chatId, id),
          CONSTRAINT role_help_chat_messages_chat_fk
            FOREIGN KEY (chatId) REFERENCES role_help_chats (id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
    })().catch((error) => {
      tablesReadyPromise = null;
      throw error;
    });
  }
  await tablesReadyPromise;
};
