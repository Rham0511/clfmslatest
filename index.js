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
    
import dotenv from "dotenv";
dotenv.config();
import express from "express";
import path from "path";
import session from "express-session";
import flash from "connect-flash";
import "./models/maintenanceRequestModel.js";
import "./models/attendanceModel.js";
import "./models/attendanceSessionModel.js";
import "./models/laboratoryScheduleModel.js";
import { ensureInstructorDirectoryTable } from "./models/instructorDirectoryModel.js";
import { ensureClassListEntryTable } from "./models/classListEntryModel.js";
import { ensureEquipmentAssignmentTable } from "./models/equipmentAssignmentModel.js";
import { ensureBorrowRequestAccountabilityTable } from "./models/borrowRequestAccountabilityModel.js";
import { SequelizeSessionStore } from "./models/sessionStore.js";
import "./models/borrowRecordModel.js";
import "./models/equipmentModel.js";
import "./models/userModel.js";
import router from "./routes/index.js";
import maintenanceRouter from "./routes/maintenanceRoutes.js";
import equipmentEnhancementsRouter from "./routes/equipmentEnhancementsRoutes.js";
import archiveRouter from "./routes/archiveRoutes.js";
import { sequelize } from "./models/db.js";
import { ensureArchiveRecordsTable } from "./models/archiveRecords.js";
import { ensureAttendancePcStationColumn } from "./models/attendanceModel.js";
import { ensurePCStationAutoLogoutColumn } from "./models/pcStationSessionModel.js";
import { ensureRoleHelpChatTables } from "./models/roleHelpChatModel.js";
import { expirePCStationSessions } from "./controllers/pcStationController.js";
import fs from 'fs';
import hbs from "hbs";
import { fileURLToPath } from "url";
import { dirname } from "path";
import { getSmtpConfigStatus } from "./utils/mailer.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const sessionStore = new SequelizeSessionStore();
const configuredSessionSecret = String(process.env.SESSION_SECRET || "").trim();
const devFallbackSessionSecret = "comlab-development-session-secret-123456";
const sessionSecret = configuredSessionSecret || devFallbackSessionSecret;

if (!configuredSessionSecret && process.env.NODE_ENV !== "production") {
  console.warn("⚠️ SESSION_SECRET is not configured. Using a local development fallback secret until you set SESSION_SECRET in your environment.");
} else if (!configuredSessionSecret || configuredSessionSecret.length < 32) {
  const environmentLabel = process.env.NODE_ENV === "production" ? "production" : "local development";
  if (process.env.NODE_ENV === "production") {
    throw new Error(`SESSION_SECRET must be configured with at least 32 characters before starting ${environmentLabel}.`);
  }
  console.warn(`⚠️ SESSION_SECRET is shorter than 32 characters for ${environmentLabel}; using the development fallback secret instead.`);
}

// Trust proxy - required when behind nginx/cloudflare
app.set('trust proxy', 1);

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.get('/service-worker.js', (req, res) => {
  res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.type('application/javascript').sendFile(path.join(__dirname, 'public', 'service-worker.js'));
});
app.get('/manifest.webmanifest', (req, res) => {
  res.set('Cache-Control', 'no-cache');
  res.type('application/manifest+json').sendFile(path.join(__dirname, 'public', 'manifest.webmanifest'));
});
app.use(express.static(path.join(process.cwd(), "public")));
app.use((req, res, next) => {
  const send = res.send;
  res.send = function (body) {
    if (typeof body === "string" && /<(?:!doctype html|html)\b/i.test(body)) {
      const dialogScript = '<script src="/js/custom-dialogs.js"></script>';
      const pwaHead = '<link rel="manifest" href="/manifest.webmanifest"><meta name="theme-color" content="#062719"><meta name="mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-title" content="ComLab"><link rel="apple-touch-icon" href="/images/comlab-app-192.png"><link rel="stylesheet" href="/css/pwa-install.css">';
      const pwaScript = '<script src="/js/pwa-install.js" defer></script>';
      if (!/href=["']\/manifest\.webmanifest["']/i.test(body) && /<\/head>/i.test(body)) {
        body = body.replace(/<\/head>/i, `${pwaHead}</head>`);
      }
      if (!/src=["'][^"']*\/js\/custom-dialogs\.js(?:\?[^"']*)?["']/i.test(body)) {
        if (/<\/head>/i.test(body)) {
          body = body.replace(/<\/head>/i, `${dialogScript}</head>`);
        } else if (/<\/body>/i.test(body)) {
          body = body.replace(/<\/body>/i, `${dialogScript}</body>`);
        } else {
          body = `${dialogScript}${body}`;
        }
      }
      if (!/src=["'][^"']*\/js\/pwa-install\.js(?:\?[^"']*)?["']/i.test(body)) {
        if (/<\/body>/i.test(body)) body = body.replace(/<\/body>/i, `${pwaScript}</body>`);
        else body += pwaScript;
      }
    }
    return send.call(this, body);
  };
  next();
});

app.use(session({
  secret: sessionSecret,
  store: sessionStore,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax"
  }
}));
app.use(flash());

app.engine("xian", async (filePath, options, callback) => {
  try {
     const originalPartialsDir = hbs.partialsDir;
    hbs.partialsDir = path.join(__dirname, 'views');

    const result = await new Promise((resolve, reject) => {
      hbs.__express(filePath, options, (err, html) => {
        if (err) return reject(err);
        resolve(html);
      });
    });

    hbs.partialsDir = originalPartialsDir;
    callback(null, result);
  } catch (err) {
    callback(err);
  }
});
app.use((req, res, next) => {
  res.locals.success_msg = req.flash("success_msg");
  res.locals.error_msg = req.flash("error_msg");
  next();
});


app.set("views", path.join(__dirname, "views"));
app.set("view engine", "xian");
const partialsDir = path.join(__dirname, "views/partials");
fs.readdir(partialsDir, (err, files) => {
  if (err) {
    console.error("❌ Could not read partials directory:", err);
    return;
  }

   files
    .filter(file => file.endsWith('.xian'))
    .forEach(file => {
      const partialName = file.replace('.xian', ''); 
      const fullPath = path.join(partialsDir, file);

      fs.readFile(fullPath, 'utf8', (err, content) => {
        if (err) {
          console.error(`❌ Failed to read partial: ${file}`, err);
          return;
        }
        hbs.registerPartial(partialName, content);
        
      });
    });
});

app.use("/", maintenanceRouter);
app.use("/", archiveRouter);
app.use("/api/equipment-enhancements", equipmentEnhancementsRouter);
app.use("/", router);

const smtpStatus = getSmtpConfigStatus();
if (!smtpStatus.isConfigured) {
  console.warn(`⚠️ SMTP is not configured: missing ${smtpStatus.missing.join(", ")}. Email verification mail will be disabled until these environment variables are set.`);
} else {
  console.log("✅ SMTP environment variables are present.");
}

export default app;

  if (!process.env.ELECTRON) {
    const initializeDatabase = async () => {
    const maxRetries = 3;
    let lastError;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        await sequelize.authenticate();
        console.log("✅ Database connected");
        await sessionStore.sync({ alter: false, logging: false });
        console.log("✅ Persistent session store is ready");

        // Database tables are managed via SQL migrations
        // Sync is disabled to prevent schema conflicts
        try {
          await ensureClassListEntryTable();
          await ensureInstructorDirectoryTable();
          await ensureEquipmentAssignmentTable();
          await ensureBorrowRequestAccountabilityTable();
          await ensureArchiveRecordsTable();
          await ensureAttendancePcStationColumn();
          await ensurePCStationAutoLogoutColumn();
          await ensureRoleHelpChatTables();
          // await sequelize.sync({ force: false, alter: false, logging: false });
          console.log("✅ Database tables are ready");
        } catch (syncError) {
          console.warn("⚠️ Database schema sync skipped:", syncError.message);
        }

        return; // Success
      } catch (err) {
        lastError = err;
        if (attempt < maxRetries) {
          const delay = Math.pow(2, attempt) * 1000; // Exponential backoff: 2s, 4s, 8s
          console.warn(`⚠️  Database initialization attempt ${attempt} failed. Retrying in ${delay}ms...`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }

    console.error("❌ Database initialization failed after retries:", lastError);
    process.exit(1);
  };

  const startServer = async (port, retries = 3) => {
    try {
      await initializeDatabase();
    } catch {
      return;
    }

    const server = app.listen(port, HOST, () => {
      const displayHost = HOST === "0.0.0.0" ? "localhost" : HOST;
      console.log(`🔥 XianFire running at http://${displayHost}:${port}`);
      if (HOST === "0.0.0.0") {
        console.log("   Listening on all network interfaces (0.0.0.0). Use your PC LAN IP to access from other devices.");
      }
      let expirationRunning = false;
      const expirationTimer = setInterval(async () => {
        if (expirationRunning) return;
        expirationRunning = true;
        try {
          await expirePCStationSessions();
        } catch (error) {
          console.error("[PCStation] Failed to expire class sessions:", error);
        } finally {
          expirationRunning = false;
        }
      }, 15_000);
      expirationTimer.unref?.();
    });

    server.on("error", (err) => {
      if (err.code === "EADDRINUSE") {
        console.error(`❌ Port ${port} is already in use.`);
        if (retries > 0) {
          const nextPort = port + 1;
          console.log(`Trying next available port: ${nextPort}`);
          startServer(nextPort, retries - 1);
          return;
        }
        console.error(`No available ports found after retries. Set PORT to a free port and restart.`);
        process.exit(1);
      }

      console.error("❌ Server failed to start:", err.message);
      if (err.code === "EACCES") {
        console.error(`Permission denied when trying to bind to port ${port}. Use a port above 1024 or run with elevated privileges.`);
      }
      process.exit(1);
    });

    server.on("listening", () => {
      process.on("unhandledRejection", (reason) => {
        console.error("❌ Unhandled promise rejection during runtime:", reason);
      });
    });

    return server;
  };

  startServer(Number(PORT) || 3000);
}
