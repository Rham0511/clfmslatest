import session from "express-session";
import { DataTypes, Op } from "sequelize";
import { sequelize } from "./db.js";

const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const SessionRecord = sequelize.define("ComLabSession", {
  sid: {
    type: DataTypes.STRING(128),
    primaryKey: true,
    allowNull: false
  },
  expires: {
    type: DataTypes.DATE,
    allowNull: false
  },
  data: {
    type: DataTypes.TEXT,
    allowNull: false
  }
}, {
  tableName: "sessions",
  timestamps: false,
  indexes: [{ fields: ["expires"], name: "idx_sessions_expires" }]
});

export class SequelizeSessionStore extends session.Store {
  constructor() {
    super();
    this.expirationTimer = setInterval(() => {
      this.clearExpiredSessions((error) => {
        if (error) console.error("Failed to remove expired sessions:", error);
      });
    }, 15 * 60 * 1000);
    this.expirationTimer.unref();
  }

  sync() {
    return SessionRecord.sync({ alter: false, logging: false });
  }

  get(sid, callback) {
    SessionRecord.findByPk(sid)
      .then(async (record) => {
        if (!record) return callback(null, null);
        if (record.expires && new Date(record.expires).getTime() <= Date.now()) {
          await record.destroy();
          return callback(null, null);
        }
        callback(null, JSON.parse(record.data));
      })
      .catch(callback);
  }

  set(sid, sessionData, callback = () => {}) {
    const cookieExpiry = sessionData.cookie?.expires
      ? new Date(sessionData.cookie.expires)
      : null;
    const expires = cookieExpiry && !Number.isNaN(cookieExpiry.getTime())
      ? cookieExpiry
      : new Date(Date.now() + SESSION_MAX_AGE_MS);
    SessionRecord.upsert({
      sid,
      expires,
      data: JSON.stringify(sessionData)
    }).then(() => callback()).catch(callback);
  }

  touch(sid, sessionData, callback = () => {}) {
    const cookieExpiry = sessionData.cookie?.expires
      ? new Date(sessionData.cookie.expires)
      : null;
    const expires = cookieExpiry && !Number.isNaN(cookieExpiry.getTime())
      ? cookieExpiry
      : new Date(Date.now() + SESSION_MAX_AGE_MS);
    SessionRecord.update({ expires }, { where: { sid } })
      .then(() => callback())
      .catch(callback);
  }

  destroy(sid, callback = () => {}) {
    SessionRecord.destroy({ where: { sid } })
      .then(() => callback())
      .catch(callback);
  }

  clearExpiredSessions(callback = () => {}) {
    SessionRecord.destroy({ where: { expires: { [Op.lt]: new Date() } } })
      .then(() => callback())
      .catch(callback);
  }
}
