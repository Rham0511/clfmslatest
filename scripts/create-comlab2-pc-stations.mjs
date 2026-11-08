import 'dotenv/config';
import mysql from 'mysql2/promise';

const actorId = Number(process.env.PC_SET_CREATED_BY || '');
if (!Number.isSafeInteger(actorId) || actorId <= 0) {
  throw new Error('Set PC_SET_CREATED_BY to the ID of the admin performing this one-time inventory setup.');
}

const connection = await mysql.createConnection({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'comlab',
  password: process.env.DB_PASSWORD || 'comlab123',
  database: process.env.DB_NAME || 'comlab',
  port: Number(process.env.DB_PORT || 3306)
});

const firstStationNumber = 32;
const lastStationNumber = 66;
const readyStationCount = 8;
const requiredCategories = ['System Unit', 'Monitor', 'Keyboard', 'Mouse'];
const expectedLabName = 'COMLAB 2';
const expectedCampus = 'Bongabong';

try {
  await connection.beginTransaction();

  const [labs] = await connection.query(
    `SELECT id, name, campus
     FROM computer_labs
     WHERE BINARY name = BINARY ? AND BINARY campus = BINARY ?
     FOR UPDATE`,
    [expectedLabName, expectedCampus]
  );
  if (labs.length !== 1) throw new Error('Could not identify exactly one Bongabong COMLAB 2.');
  const labId = Number(labs[0].id);

  const setIds = Array.from({ length: lastStationNumber - firstStationNumber + 1 }, (_, index) => {
    const number = String(firstStationNumber + index).padStart(3, '0');
    return { setId: `PC-SET-${number}`, setName: `PC Station ${number}` };
  });
  const setPlaceholders = setIds.map(() => '?').join(',');
  const [conflicts] = await connection.query(
    `SELECT setId FROM equipment_sets WHERE setId IN (${setPlaceholders}) FOR UPDATE`,
    setIds.map(({ setId }) => setId)
  );
  if (conflicts.length) {
    throw new Error(`Station IDs already exist: ${conflicts.map(({ setId }) => setId).join(', ')}. Nothing was changed.`);
  }

  const placeholders = requiredCategories.map(() => '?').join(',');
  const [availableParts] = await connection.query(
    `SELECT e.id, e.equipmentId, e.serialNumber, e.category, e.status, e.setId
     FROM equipment e
     WHERE e.computerLabId = ?
       AND e.status = 'Serviceable'
       AND e.category IN (${placeholders})
       AND (e.setId IS NULL OR TRIM(e.setId) = '')
       AND NOT EXISTS (
         SELECT 1 FROM archived_records ar
         WHERE ar.entityType = 'equipment'
           AND BINARY ar.entityId = BINARY e.equipmentId
       )
     ORDER BY e.category, e.equipmentId
     FOR UPDATE`,
    [labId, ...requiredCategories]
  );

  const partsByCategory = new Map(requiredCategories.map((category) => [category, []]));
  availableParts.forEach((part) => partsByCategory.get(part.category)?.push(part));
  const shortages = requiredCategories
    .map((category) => ({ category, available: partsByCategory.get(category).length }))
    .filter(({ available }) => available < readyStationCount);
  if (shortages.length) {
    throw new Error(`Need ${readyStationCount} serviceable parts of each type to form the initial ready sets: ${shortages.map(({ category, available }) => `${category} (${available} available)`).join(', ')}. Nothing was changed.`);
  }

  const [actors] = await connection.query(
    'SELECT id, name, role FROM users WHERE id = ? FOR UPDATE',
    [actorId]
  );
  const actor = actors[0];
  if (!actor || !['admin', 'administrator'].includes(String(actor.role || '').trim().toLowerCase())) {
    throw new Error('PC_SET_CREATED_BY must identify an existing administrator. Nothing was changed.');
  }

  const setValues = setIds.map(({ setId, setName }, index) => [
    setId,
    setName,
    labId,
    index < readyStationCount ? 'active' : 'incomplete',
    actorId
  ]);
  await connection.query(
    `INSERT INTO equipment_sets
       (setId, setName, computerLabId, location, status, createdBy)
     VALUES ${setValues.map(() => '(?, ?, ?, ?, ?, ?)').join(', ')}`,
    setValues.flatMap(([setId, setName, computerLabId, status, createdBy]) => [
      setId, setName, computerLabId, expectedLabName, status, createdBy
    ])
  );

  let assignedCount = 0;
  const assignedSetIds = [];
  for (let stationIndex = 0; stationIndex < readyStationCount; stationIndex += 1) {
    const setId = setIds[stationIndex].setId;
    assignedSetIds.push(setId);

    for (const category of requiredCategories) {
      const equipment = partsByCategory.get(category)[stationIndex];
      const [update] = await connection.query(
        `UPDATE equipment
         SET setId = ?
         WHERE id = ? AND computerLabId = ? AND category = ?
           AND status = 'Serviceable' AND (setId IS NULL OR TRIM(setId) = '')`,
        [setId, equipment.id, labId, category]
      );
      if (update.affectedRows !== 1) {
        throw new Error(`Could not safely assign ${equipment.equipmentId} to ${setId}. Nothing was committed.`);
      }

      await connection.query(
        `INSERT INTO equipment_audit_trail
           (equipmentId, serialNumber, actionType, actionDescription, performedBy,
            performedByName, userRole, beforeState, afterState, ipAddress, userAgent, actionTimestamp)
         VALUES (?, ?, 'assigned_to_set', ?, ?, ?, 'admin', ?, ?, NULL, NULL, NOW())`,
        [
          equipment.id,
          equipment.serialNumber || null,
          `Equipment ${equipment.equipmentId} assigned to Set ${setId}.`,
          actorId,
          actor.name,
          JSON.stringify({ setId: null }),
          JSON.stringify({ setId })
        ]
      );
      assignedCount += 1;
    }
  }

  const [assignedSets] = await connection.query(
    `SELECT es.setId, COUNT(e.id) AS componentCount,
            COUNT(DISTINCT e.category) AS categoryCount,
            SUM(CASE WHEN e.status = 'Serviceable' THEN 1 ELSE 0 END) AS serviceableCount
     FROM equipment_sets es
     LEFT JOIN equipment e ON BINARY e.setId = BINARY es.setId
     WHERE es.setId IN (${assignedSetIds.map(() => '?').join(',')})
     GROUP BY es.setId`,
    assignedSetIds
  );
  if (assignedSets.length !== readyStationCount || assignedSets.some((set) =>
    Number(set.componentCount) !== requiredCategories.length ||
    Number(set.categoryCount) !== requiredCategories.length ||
    Number(set.serviceableCount) !== requiredCategories.length
  )) {
    throw new Error('The new PC set assignments did not pass the inventory consistency check. Nothing was committed.');
  }

  await connection.commit();
  console.log(JSON.stringify({
    created: setIds.length,
    ready: readyStationCount,
    incomplete: setIds.length - readyStationCount,
    assignedEquipment: assignedCount,
    lab: expectedLabName,
    campus: expectedCampus,
    firstSetId: setIds[0].setId,
    lastSetId: setIds.at(-1).setId
  }, null, 2));
} catch (error) {
  await connection.rollback().catch(() => {});
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await connection.end();
}
