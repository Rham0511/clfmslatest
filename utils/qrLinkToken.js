import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes
} from "node:crypto";

const developmentSecret = "comlab-development-session-secret-123456";
const tokenVersion = 1;
const nonceLength = 12;
const authTagLength = 16;

const getEncryptionKey = () => {
  const secret = String(process.env.SESSION_SECRET || developmentSecret).trim();
  return createHash("sha256").update(secret).digest();
};

export const createQrLinkToken = (type, identifier) => {
  const value = String(identifier || "").trim();
  if (!["equipment", "pc-station"].includes(type) || !value || value.length > 255) {
    throw new Error("A valid QR link type and identifier are required.");
  }

  const nonce = randomBytes(nonceLength);
  const cipher = createCipheriv("aes-256-gcm", getEncryptionKey(), nonce);
  cipher.setAAD(Buffer.from(`comlab-qr-link:${tokenVersion}:${type}`));
  const encrypted = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final()
  ]);
  const token = Buffer.concat([
    Buffer.from([tokenVersion]),
    nonce,
    cipher.getAuthTag(),
    encrypted
  ]);
  return token.toString("base64url");
};

export const readQrLinkToken = (token, expectedType) => {
  if (!["equipment", "pc-station"].includes(expectedType) ||
      typeof token !== "string" ||
      !/^[A-Za-z0-9_-]+$/.test(token)) {
    return null;
  }

  const packed = Buffer.from(token, "base64url");
  if (packed.toString("base64url") !== token ||
      packed.length <= 1 + nonceLength + authTagLength ||
      packed[0] !== tokenVersion) {
    return null;
  }

  try {
    const nonceStart = 1;
    const tagStart = nonceStart + nonceLength;
    const encryptedStart = tagStart + authTagLength;
    const decipher = createDecipheriv(
      "aes-256-gcm",
      getEncryptionKey(),
      packed.subarray(nonceStart, tagStart)
    );
    decipher.setAAD(Buffer.from(`comlab-qr-link:${tokenVersion}:${expectedType}`));
    decipher.setAuthTag(packed.subarray(tagStart, encryptedStart));
    const identifier = Buffer.concat([
      decipher.update(packed.subarray(encryptedStart)),
      decipher.final()
    ]).toString("utf8");
    return identifier && identifier.length <= 255 ? identifier : null;
  } catch {
    return null;
  }
};
