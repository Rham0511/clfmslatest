import { QueryTypes } from "sequelize";
import { User } from "../models/userModel.js";
import { sequelize } from "../models/db.js";
import { ensureRoleHelpChatTables } from "../models/roleHelpChatModel.js";
import { generateRoleHelpAnswer, normalizeHelpRole } from "../utils/roleHelp.js";

const getAuthenticatedHelpUser = async (req, res) => {
  const userId = req.session?.userId;
  if (!userId) {
    res.status(401).json({ error: "Please log in to use ComLab Help." });
    return null;
  }

  const user = await User.findByPk(userId, { attributes: ["id", "role"] });
  if (!user) {
    res.status(401).json({ error: "Your account could not be verified." });
    return null;
  }

  if (!normalizeHelpRole(user.role)) {
    res.status(403).json({ error: "ComLab Help is unavailable for this account role." });
    return null;
  }

  return user;
};

const getOwnedChat = async (chatId, userId, transaction) => {
  const chats = await sequelize.query(
    "SELECT id, title FROM role_help_chats WHERE id = ? AND userId = ? LIMIT 1",
    { replacements: [chatId, userId], type: QueryTypes.SELECT, transaction }
  );
  return chats[0] || null;
};

export const listRoleHelpChats = async (req, res) => {
  try {
    const user = await getAuthenticatedHelpUser(req, res);
    if (!user) return;
    await ensureRoleHelpChatTables();

    const chats = await sequelize.query(
      `SELECT c.id, c.title, c.createdAt, c.updatedAt,
              (SELECT m.content FROM role_help_chat_messages m
               WHERE m.chatId = c.id ORDER BY m.id DESC LIMIT 1) AS lastMessage
       FROM role_help_chats c
       WHERE c.userId = ?
       ORDER BY c.updatedAt DESC, c.id DESC`,
      { replacements: [user.id], type: QueryTypes.SELECT }
    );
    return res.json({ chats });
  } catch (error) {
    console.error("[role-help] Failed to list chat history", error);
    return res.status(500).json({ error: "Unable to load chat history." });
  }
};

export const createRoleHelpChat = async (req, res) => {
  try {
    const user = await getAuthenticatedHelpUser(req, res);
    if (!user) return;
    await ensureRoleHelpChatTables();

    const [result] = await sequelize.query(
      "INSERT INTO role_help_chats (userId, title) VALUES (?, 'New chat')",
      { replacements: [user.id], type: QueryTypes.INSERT }
    );
    return res.status(201).json({ chat: { id: result, title: "New chat" } });
  } catch (error) {
    console.error("[role-help] Failed to create a chat", error);
    return res.status(500).json({ error: "Unable to start a new chat." });
  }
};

export const getRoleHelpChatMessages = async (req, res) => {
  try {
    const user = await getAuthenticatedHelpUser(req, res);
    if (!user) return;
    await ensureRoleHelpChatTables();

    const chat = await getOwnedChat(req.params.chatId, user.id);
    if (!chat) return res.status(404).json({ error: "Chat not found." });

    const messages = await sequelize.query(
      `SELECT id, sender, content, createdAt
       FROM role_help_chat_messages
       WHERE chatId = ?
       ORDER BY id ASC`,
      { replacements: [chat.id], type: QueryTypes.SELECT }
    );
    return res.json({ chat, messages });
  } catch (error) {
    console.error("[role-help] Failed to load chat messages", error);
    return res.status(500).json({ error: "Unable to load this chat." });
  }
};

export const answerRoleHelp = async (req, res) => {
  const question = typeof req.body?.question === "string" ? req.body.question.trim() : "";
  if (question.length < 2 || question.length > 500) {
    return res.status(400).json({ error: "Enter a question between 2 and 500 characters." });
  }
  const chatId = String(req.body?.chatId || "").trim();
  if (!/^\d{1,20}$/.test(chatId)) {
    return res.status(400).json({ error: "Start or select a chat before sending a question." });
  }

  try {
    const user = await getAuthenticatedHelpUser(req, res);
    if (!user) return;
    await ensureRoleHelpChatTables();

    const chat = await getOwnedChat(chatId, user.id);
    if (!chat) return res.status(404).json({ error: "Chat not found." });

    const history = await sequelize.query(
      `SELECT sender, content
       FROM role_help_chat_messages
       WHERE chatId = ?
       ORDER BY id DESC
       LIMIT 12`,
      { replacements: [chat.id], type: QueryTypes.SELECT }
    );
    history.reverse();
    const answer = await generateRoleHelpAnswer(user.role, history, question);
    if (!answer) return res.status(403).json({ error: "ComLab Help is unavailable for this account role." });

    await sequelize.transaction(async (transaction) => {
      const currentChat = await getOwnedChat(chatId, user.id, transaction);
      if (!currentChat) {
        const error = new Error("Chat not found.");
        error.status = 404;
        throw error;
      }

      const existingMessages = await sequelize.query(
        "SELECT id FROM role_help_chat_messages WHERE chatId = ? LIMIT 1",
        { replacements: [currentChat.id], type: QueryTypes.SELECT, transaction }
      );
      await sequelize.query(
        "INSERT INTO role_help_chat_messages (chatId, sender, content) VALUES (?, 'user', ?), (?, 'assistant', ?)",
        { replacements: [currentChat.id, question, currentChat.id, answer], type: QueryTypes.INSERT, transaction }
      );

      const title = question.replace(/\s+/g, " ").slice(0, 117);
      const titleWithEllipsis = title.length < question.length ? `${title}...` : title;
      await sequelize.query(
        `UPDATE role_help_chats
         SET title = CASE WHEN ? = 0 AND title = 'New chat' THEN ? ELSE title END,
             updatedAt = CURRENT_TIMESTAMP
         WHERE id = ? AND userId = ?`,
        { replacements: [existingMessages.length, titleWithEllipsis, currentChat.id, user.id], transaction }
      );
    });

    return res.json({ answer, chatId });
  } catch (error) {
    if (error.status === 404) return res.status(404).json({ error: error.message });
    console.error("[role-help] Failed to answer a help question", {
      status: error.status || 500,
      code: error.code,
      message: error.message
    });
    return res.status(error.status || 500).json({
      error: error.code === "AI_RATE_LIMITED"
        ? "Groq usage limit reached. Check the API quota and try again later."
        : error.code === "AI_NOT_CONFIGURED"
          ? "ComLab Help AI is not configured on the server. Please contact an administrator."
        : error.status === 504
          ? "ComLab Help AI took too long to respond. Please try again."
          : "Unable to answer right now. Please try again."
    });
  }
};
