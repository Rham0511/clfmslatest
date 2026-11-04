import { QueryTypes } from "sequelize";
import { sequelize } from "./db.js";

export const normalizeLabLabel = (value) => String(value || "")
  .trim()
  .replace(/\s+/g, " ")
  .toLocaleLowerCase();

export const formatComputerLabLocation = (lab) => {
  const name = String(lab?.name || "").trim();
  const room = String(lab?.roomNumber || "").trim();
  if (!name) return room;
  if (!room || normalizeLabLabel(name).includes(normalizeLabLabel(room))) return name;
  return `${name} — ${room}`;
};

export const getLegacyComputerLabNumber = (labOrLabel) => {
  const sourceKey = typeof labOrLabel === "object" ? labOrLabel?.sourceKey : "";
  const fromSource = String(sourceKey || "").match(/^legacy:computer lab (\d+)$/i)?.[1];
  if (fromSource) return Number(fromSource);
  const label = typeof labOrLabel === "object" ? labOrLabel?.name : labOrLabel;
  const match = String(label || "").match(/(?:computer\s*lab|com\s*lab|comlab|laboratory|lab)\s*[-#:]?\s*(\d+)\b/i);
  if (match) return Number(match[1]);
  const room = String(label || "").match(/\b(?:room|rm\.?)\s*[-#:]?\s*(202|204)\b/i)?.[1];
  return room === "202" ? 1 : room === "204" ? 2 : null;
};

export async function findComputerLabByLabel(label, campus) {
  const requestedLabel = String(label || "").trim();
  if (!requestedLabel || !campus) return null;
  const campusName = String(campus).trim().replace(/\s*Campus\s*$/i, "");
  const campusValues = [campusName, `${campusName} Campus`];
  const normalized = normalizeLabLabel(requestedLabel);
  const labs = await sequelize.query(
    `SELECT id, name, roomNumber, campus, sourceKey
     FROM computer_labs
     WHERE campus IN (:campusValues)
     ORDER BY id ASC`,
    { replacements: { campusValues }, type: QueryTypes.SELECT }
  );
  const exact = labs.find((lab) => {
    const labels = [lab.name, formatComputerLabLocation(lab), `${lab.name} - ${lab.roomNumber || ""}`];
    return labels.some((candidate) => normalizeLabLabel(candidate) === normalized);
  });
  if (exact) return exact;

  const legacyNumber = getLegacyComputerLabNumber(requestedLabel);
  if (!legacyNumber) return null;
  return labs.find((lab) => getLegacyComputerLabNumber(lab) === legacyNumber) || null;
}
