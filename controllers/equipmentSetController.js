import mysql from 'mysql2/promise';
import { sequelize } from '../models/db.js';
import { getUserCampusFromSession } from './campusAuthController.js';
import { ensureArchiveRecordsTable, getArchivedEntityIds } from '../models/archiveRecords.js';

// Get database config from environment
const {
  DB_HOST = 'localhost',
  DB_USER = 'comlab',
  DB_PASSWORD = 'comlab123',
  DB_NAME = 'comlab',
  DB_PORT = '3306'
} = process.env;

// Database pool
const pool = mysql.createPool({
  host: DB_HOST,
  user: DB_USER,
  password: DB_PASSWORD,
  database: DB_NAME,
  port: Number(DB_PORT),
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

function getDisplaySetId(set) {
  const setId = String(set?.setId || '');
  const lab = `${set?.location || ''} ${set?.laboratoryRoom || ''}`;
  const isComputerLab = /\bCOM\s*LAB\s*[12]\b/i.test(lab);
  const stationNumber = String(set?.setName || '').match(/(?:PC\s*Station|Station)\s*[-#:]?\s*(\d+)\s*$/i)?.[1];
  return isComputerLab && stationNumber
    ? `PC-SET-${String(Number(stationNumber)).padStart(3, '0')}`
    : setId;
}

/**
 * Recalculate and update PC Set status based on current component statuses.
 * Called whenever a component is added, removed, or changes status.
 * Rules:
 *   Any Missing component       → incomplete
 *   Any Under Maintenance       → maintenance
 *   Any Unserviceable           → incomplete
 *   All Serviceable + System Unit+Monitor → active
 *   Otherwise                   → incomplete
 */
async function recalculateSetStatusInternal(setId) {
  if (!setId) return;
  try {
    const [components] = await pool.query(
      'SELECT category, status FROM equipment WHERE setId = ?',
      [setId]
    );

    if (!components.length) {
      await pool.query("UPDATE equipment_sets SET status = 'incomplete', updatedAt = NOW() WHERE setId = ?", [setId]);
      return;
    }

    const statuses = components.map(c => String(c.status || '').toLowerCase());
    const categories = components.map(c => String(c.category || '').toLowerCase());

    let newStatus = 'active';
    if (statuses.some(s => s === 'missing')) {
      newStatus = 'incomplete';
    } else if (statuses.some(s => ['under maintenance', 'for repair'].includes(s))) {
      newStatus = 'maintenance';
    } else if (statuses.some(s => ['unserviceable', 'for disposal', 'lost'].includes(s))) {
      newStatus = 'incomplete';
    } else {
      const hasCpu = categories.some(c => c === 'cpu' || c === 'computer' || c === 'system unit');
      const hasMonitor = categories.some(c => c === 'monitor');
      if (!hasCpu || !hasMonitor) newStatus = 'incomplete';
    }

    await pool.query("UPDATE equipment_sets SET status = ?, updatedAt = NOW() WHERE setId = ?", [newStatus, setId]);
  } catch (err) {
    console.warn(`[set] recalculateSetStatusInternal failed for ${setId}:`, err.message);
  }
}

// Get all PC sets with component counts
export async function getAllPCSets(req, res) {
  try {
    await ensureArchiveRecordsTable();
    const [sets] = await pool.query(`
      SELECT 
        es.*,
        COALESCE(componentStats.componentCount, 0) as componentCount,
        COALESCE(componentStats.serviceableCount, 0) as serviceableCount,
        COALESCE(componentStats.missingCount, 0) as missingCount,
        COALESCE(componentStats.unserviceableCount, 0) as unserviceableCount,
        COALESCE(componentStats.underMaintenanceCount, 0) as underMaintenanceCount,
        COALESCE(componentStats.hasCpu, 0) as hasCpu,
        COALESCE(componentStats.hasMonitor, 0) as hasMonitor,
        componentStats.components,
        COALESCE(componentStats.campus, stationLab.campus) as campus,
        COALESCE(
          componentStats.laboratoryRoom,
          CONCAT(stationLab.name, IF(stationLab.roomNumber IS NULL OR TRIM(stationLab.roomNumber) = '', '', CONCAT(' — ', stationLab.roomNumber)))
        ) as laboratoryRoom,
        COALESCE(componentStats.campusCount, 0) as campusCount,
        componentStats.componentCategories,
        CASE
          WHEN es.status = 'retired' THEN 'retired'
          WHEN COALESCE(componentStats.componentCount, 0) = 0 THEN 'incomplete'
          WHEN COALESCE(componentStats.missingCount, 0) > 0
            OR COALESCE(componentStats.unserviceableCount, 0) > 0
            OR COALESCE(componentStats.hasCpu, 0) = 0
            OR COALESCE(componentStats.hasMonitor, 0) = 0 THEN 'incomplete'
          WHEN COALESCE(componentStats.underMaintenanceCount, 0) > 0 THEN 'maintenance'
          ELSE 'active'
        END as computedStatus
      FROM equipment_sets es
      LEFT JOIN (
        SELECT
          setId,
          COUNT(*) as componentCount,
          SUM(CASE WHEN status = 'Serviceable' THEN 1 ELSE 0 END) as serviceableCount,
          SUM(CASE WHEN status = 'Missing' THEN 1 ELSE 0 END) as missingCount,
          SUM(CASE WHEN status = 'Unserviceable' THEN 1 ELSE 0 END) as unserviceableCount,
          SUM(CASE WHEN status = 'Under Maintenance' THEN 1 ELSE 0 END) as underMaintenanceCount,
          MAX(CASE WHEN LOWER(category) IN ('cpu', 'computer', 'system unit') THEN 1 ELSE 0 END) as hasCpu,
          MAX(CASE WHEN LOWER(category) = 'monitor' THEN 1 ELSE 0 END) as hasMonitor,
          MAX(campus) as campus,
          MAX(laboratoryRoom) as laboratoryRoom,
          COUNT(DISTINCT campus) as campusCount,
          GROUP_CONCAT(DISTINCT category SEPARATOR '|||') as componentCategories,
          GROUP_CONCAT(
            CONCAT(category, ' - ', name, ' [', status, ']')
            ORDER BY category, name
            SEPARATOR ', '
          ) as components
        FROM equipment
        WHERE setId IS NOT NULL AND TRIM(setId) <> ''
        GROUP BY setId
      ) componentStats ON BINARY componentStats.setId = BINARY es.setId
      LEFT JOIN computer_labs stationLab ON stationLab.id = es.computerLabId
      WHERE NOT EXISTS (
        SELECT 1
        FROM archived_records ar
        WHERE ar.entityType = 'pc-set' AND BINARY ar.entityId = BINARY es.setId
      )
      ORDER BY es.setId
    `);

    const [unassigned] = await pool.query(`
      SELECT id, equipmentId, name, category, serialNumber, status, campus, laboratoryRoom
      FROM equipment
      WHERE (setId IS NULL OR TRIM(setId) = '')
        AND NOT EXISTS (
          SELECT 1 FROM archived_records ar
          WHERE ar.entityType = 'equipment' AND BINARY ar.entityId = BINARY equipment.equipmentId
        )
      ORDER BY campus, category, name, equipmentId
    `);

    const result = sets.map(s => ({
      ...s,
      displaySetId: getDisplaySetId(s),
      componentCategories: s.componentCategories ? String(s.componentCategories).split('|||') : [],
      status: s.computedStatus,
      completenessPercent: s.componentCount > 0
        ? Math.round((Number(s.serviceableCount || 0) / Number(s.componentCount)) * 100)
        : 0
    }));

    res.json({
      success: true,
      sets: result,
      unassigned: {
        count: unassigned.length,
        equipment: unassigned
      }
    });
  } catch (error) {
    console.error('Error fetching PC sets:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch PC sets', error: error.message });
  }
}

// Get single PC set with components
export async function getPCSetDetails(req, res) {
  try {
    const { setId } = req.params;
    if ((await getArchivedEntityIds('pc-set')).includes(String(setId))) {
      return res.status(404).json({ success: false, message: 'PC set not found' });
    }

    // Get set details
    const [sets] = await pool.query(
      'SELECT * FROM equipment_sets WHERE setId = ?',
      [setId]
    );

    if (sets.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'PC set not found'
      });
    }

    // Get components — include all statuses so Missing equipment still shows in its set
    const [components] = await pool.query(`
      SELECT 
        id,
        equipmentId,
        name,
        category,
        serialNumber,
        manufacturer,
        model,
        status,
        \`condition\`,
        location,
        missingReportedAt,
        missingReason,
        dateAdded
      FROM equipment
      WHERE setId = ?
      ORDER BY 
        FIELD(category, 'System Unit', 'CPU', 'Monitor', 'Keyboard', 'Mouse', 'AVR', 'Other'),
        name
    `, [setId]);

    // Calculate completeness percentage
    const totalComponents = components.length;
    const serviceableComponents = components.filter(c =>
      String(c.status || '').toLowerCase() === 'serviceable'
    ).length;
    const missingComponents = components.filter(c =>
      String(c.status || '').toLowerCase() === 'missing'
    ).length;
    const completenessPercent = totalComponents > 0
      ? Math.round((serviceableComponents / totalComponents) * 100)
      : 0;
    const statuses = components.map(component => String(component.status || '').toLowerCase());
    const categories = components.map(component => String(component.category || '').toLowerCase());
    let computedStatus = sets[0].status;
    if (computedStatus !== 'retired') {
      if (!components.length
        || statuses.some(status => ['missing', 'unserviceable', 'for disposal', 'lost'].includes(status))
        || !categories.some(category => ['cpu', 'computer', 'system unit'].includes(category))
        || !categories.includes('monitor')) {
        computedStatus = 'incomplete';
      } else if (statuses.some(status => ['under maintenance', 'for repair'].includes(status))) {
        computedStatus = 'maintenance';
      } else {
        computedStatus = 'active';
      }
    }
    const setDetails = {
      ...sets[0],
      displaySetId: getDisplaySetId(sets[0]),
      status: computedStatus
    };

    res.json({
      success: true,
      set: setDetails,
      components,
      summary: {
        total: totalComponents,
        serviceable: serviceableComponents,
        missing: missingComponents,
        unserviceable: components.filter(c => String(c.status || '').toLowerCase() === 'unserviceable').length,
        underMaintenance: components.filter(c => String(c.status || '').toLowerCase() === 'under maintenance').length,
        completenessPercent
      }
    });
  } catch (error) {
    console.error('Error fetching PC set details:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch PC set details',
      error: error.message
    });
  }
}

// Create new PC set
export async function createPCSet(req, res) {
  try {
    const { setId, setName, description, location } = req.body;
    const userId = req.session?.userId;
    const userCampus = await getUserCampusFromSession(req);

    if (!userId || !userCampus) {
      return res.status(403).json({
        success: false,
        message: 'Your account must be signed in and assigned to a campus to create a PC set.'
      });
    }

    const normalizedSetId = String(setId || '').trim().toUpperCase();
    const normalizedSetName = String(setName || '').trim();
    const normalizedLocation = String(location || '').trim().toUpperCase().replace(/\s+/g, ' ');
    if (!/^PC-SET-\d{3,}$/i.test(normalizedSetId) || !normalizedSetName || !['COMLAB 1', 'COMLAB 2'].includes(normalizedLocation)) {
      return res.status(400).json({
        success: false,
        message: 'Provide a PC Set ID (PC-SET-###), station name, and valid ComLab location.'
      });
    }

    const [existing] = await pool.query(
      'SELECT id FROM equipment_sets WHERE setId = ?',
      [normalizedSetId]
    );

    if (existing.length > 0) {
      return res.status(409).json({
        success: false,
        message: 'Set ID already exists'
      });
    }

    await pool.query(`
      INSERT INTO equipment_sets (setId, setName, description, campusId, laboratoryId, location, status, createdBy)
      VALUES (?, ?, ?, ?, ?, ?, 'incomplete', ?)
    `, [normalizedSetId, normalizedSetName, String(description || '').trim() || null, null, null, normalizedLocation, userId]);

    res.json({
      success: true,
      message: 'PC set created successfully',
      setId: normalizedSetId,
      campus: userCampus
    });
  } catch (error) {
    console.error('Error creating PC set:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create PC set',
      error: error.message
    });
  }
}

// Update PC set
export async function updatePCSet(req, res) {
  try {
    const { setId } = req.params;
    const { setName, description, campusId, laboratoryId, location, status } = req.body;

    // Validate
    if (!setName) {
      return res.status(400).json({
        success: false,
        message: 'Set Name is required'
      });
    }

    // Check if exists
    const [existing] = await pool.query(
      'SELECT id FROM equipment_sets WHERE setId = ?',
      [setId]
    );

    if (existing.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'PC set not found'
      });
    }

    // Update
    await pool.query(`
      UPDATE equipment_sets 
      SET setName = ?, 
          description = ?, 
          campusId = ?, 
          laboratoryId = ?, 
          location = ?,
          status = ?,
          updatedAt = CURRENT_TIMESTAMP
      WHERE setId = ?
    `, [setName, description, campusId, laboratoryId, location, status, setId]);

    res.json({
      success: true,
      message: 'PC set updated successfully'
    });
  } catch (error) {
    console.error('Error updating PC set:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update PC set',
      error: error.message
    });
  }
}

// Delete PC set
export async function deletePCSet(req, res) {
  return res.status(410).json({
    success: false,
    message: 'Permanent deletion is disabled. Use Archive instead.'
  });
}

// Get available equipment (not in any set)
export async function getAvailableEquipment(req, res) {
  try {
    await ensureArchiveRecordsTable();
    const [equipment] = await pool.query(`
      SELECT 
        id,
        equipmentId,
        name,
        category,
        serialNumber,
        manufacturer,
        model,
        status,
        campus,
        laboratoryRoom
      FROM equipment
      WHERE (setId IS NULL OR TRIM(setId) = '')
        AND status = 'Serviceable'
        AND NOT EXISTS (
          SELECT 1 FROM archived_records ar
          WHERE ar.entityType = 'equipment' AND BINARY ar.entityId = BINARY equipment.equipmentId
        )
      ORDER BY category, name
    `);

    res.json({
      success: true,
      equipment
    });
  } catch (error) {
    console.error('Error fetching available equipment:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch available equipment',
      error: error.message
    });
  }
}

// Add equipment to set
export async function addComponentToSet(req, res) {
  let connection;
  let transactionStarted = false;
  try {
    const { setId } = req.params;
    const { equipmentIds } = req.body;
    if ((await getArchivedEntityIds('pc-set')).includes(String(setId))) {
      return res.status(404).json({ success: false, message: 'PC set not found' });
    }
    const userId = Number(req.session?.userId);
    if (!Number.isSafeInteger(userId) || userId <= 0) {
      return res.status(401).json({
        success: false,
        message: 'Authentication is required to assign equipment to a set.'
      });
    }

    if (!Array.isArray(equipmentIds) || equipmentIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Equipment IDs array is required'
      });
    }

    const ids = equipmentIds.map(Number);
    if (ids.some(id => !Number.isSafeInteger(id) || id <= 0) || new Set(ids).size !== ids.length) {
      return res.status(400).json({
        success: false,
        message: 'Equipment IDs must be unique positive integers.'
      });
    }

    connection = await pool.getConnection();
    await connection.beginTransaction();
    transactionStarted = true;

    // Lock both the target set and equipment rows so simultaneous requests
    // cannot assign the same equipment to different sets.
    const [set] = await connection.query(
      'SELECT id FROM equipment_sets WHERE setId = ? FOR UPDATE',
      [setId]
    );
    if (set.length === 0) {
      await connection.rollback();
      transactionStarted = false;
      return res.status(404).json({
        success: false,
        message: 'PC set not found'
      });
    }

    const placeholders = ids.map(() => '?').join(',');
    const [eqRows] = await connection.query(
      `SELECT id, setId, status, equipmentId, serialNumber, category FROM equipment WHERE id IN (${placeholders}) FOR UPDATE`,
      ids
    );
    if (eqRows.length !== ids.length) {
      await connection.rollback();
      transactionStarted = false;
      const foundIds = new Set(eqRows.map(row => Number(row.id)));
      const missingId = ids.find(id => !foundIds.has(id));
      return res.status(404).json({
        success: false,
        message: `Equipment ID ${missingId} not found. No components were added.`
      });
    }

    for (const eq of eqRows) {
      const assignedSetId = String(eq.setId || '').trim();
      if (assignedSetId) {
        await connection.rollback();
        transactionStarted = false;
        const reason = assignedSetId === setId
          ? `Equipment ${eq.equipmentId} is already assigned to Set ${assignedSetId}.`
          : `Equipment ${eq.equipmentId} is already assigned to Set ${assignedSetId}. Use the Transfer endpoint to move it.`;
        return res.status(409).json({
          success: false,
          message: `${reason} No components were added.`
        });
      }
      if (String(eq.status || '').toLowerCase() === 'missing') {
        await connection.rollback();
        transactionStarted = false;
        return res.status(409).json({
          success: false,
          message: `Equipment ${eq.equipmentId} is marked Missing and cannot be added to a set. No components were added.`
        });
      }
    }

    const [assignedRows] = await connection.query(
      'SELECT category FROM equipment WHERE setId = ? FOR UPDATE',
      [setId]
    );
    const categoriesInSet = new Set(
      assignedRows.map(row => String(row.category || '').trim().toLowerCase()).filter(Boolean)
    );
    const requestedCategories = new Set();
    for (const eq of eqRows) {
      const category = String(eq.category || '').trim().toLowerCase();
      if (category && categoriesInSet.has(category)) {
        await connection.rollback();
        transactionStarted = false;
        return res.status(409).json({
          success: false,
          message: `This PC set already has a ${eq.category} component. A PC set cannot contain duplicate component types. No components were added.`
        });
      }
      if (category && requestedCategories.has(category)) {
        await connection.rollback();
        transactionStarted = false;
        return res.status(409).json({
          success: false,
          message: `More than one ${eq.category} was selected. A PC set can only have one component of each type. No components were added.`
        });
      }
      if (category) requestedCategories.add(category);
    }

    const [updateResult] = await connection.query(`
      UPDATE equipment 
      SET setId = ?
      WHERE id IN (${placeholders})
        AND (setId IS NULL OR TRIM(setId) = '')
        AND status != 'Missing'
    `, [setId, ...ids]);
    if (updateResult.affectedRows !== ids.length) {
      await connection.rollback();
      transactionStarted = false;
      return res.status(409).json({
        success: false,
        message: 'One or more equipment items were assigned elsewhere before this request completed. No components were added.'
      });
    }

    const [userRows] = await connection.query(
      'SELECT name FROM users WHERE id = ? LIMIT 1',
      [userId]
    );
    if (!userRows.length) {
      throw new Error(`Authenticated user ${userId} was not found while recording equipment assignment history.`);
    }

    const rawRole = String(req.session?.userRole || '').trim().toLowerCase();
    const auditRole = ['student', 'faculty', 'technician', 'admin'].includes(rawRole)
      ? rawRole
      : ['laboratory technician', 'lab technician'].includes(rawRole)
        ? 'technician'
        : rawRole === 'administrator' ? 'admin' : null;
    for (const equipment of eqRows) {
      await connection.query(
        `INSERT INTO equipment_audit_trail
          (equipmentId, serialNumber, actionType, actionDescription, performedBy, performedByName,
           userRole, beforeState, afterState, ipAddress, userAgent, actionTimestamp)
         VALUES (?, ?, 'assigned_to_set', ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
        [
          equipment.id,
          equipment.serialNumber || null,
          `Equipment ${equipment.equipmentId} assigned to Set ${setId}.`,
          userId,
          userRows[0].name || null,
          auditRole,
          JSON.stringify({ setId: null }),
          JSON.stringify({ setId }),
          req.ip || null,
          req.get('user-agent') || null
        ]
      );
    }

    await connection.commit();
    transactionStarted = false;

    // Recalculate set status
    await recalculateSetStatusInternal(setId);

    res.json({
      success: true,
      message: `${ids.length} component(s) added to set`
    });
  } catch (error) {
    if (transactionStarted && connection) {
      await connection.rollback();
    }
    console.error('Error adding components to set:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to add components to set',
      error: error.message
    });
  } finally {
    connection?.release();
  }
}

// Remove equipment from set
export async function removeComponentFromSet(req, res) {
  try {
    const { setId, equipmentId } = req.params;

    // Check current equipment status — NEVER clear setId for Missing equipment
    const [eqRows] = await pool.query(
      'SELECT id, status, equipmentId AS eqCode, serialNumber FROM equipment WHERE id = ? LIMIT 1',
      [equipmentId]
    );

    if (!eqRows.length) {
      return res.status(404).json({ success: false, message: 'Component not found' });
    }

    const eq = eqRows[0];
    if (String(eq.status || '').toLowerCase() === 'missing') {
      return res.status(409).json({
        success: false,
        message: `Cannot remove Missing equipment (${eq.eqCode}) from its set. The set relationship must be preserved. Mark it as Found first.`
      });
    }

    // Remove from set (only for non-Missing equipment)
    const [result] = await pool.query(`
      UPDATE equipment 
      SET setId = NULL
      WHERE id = ? AND setId = ? AND status != 'Missing'
    `, [equipmentId, setId]);

    if (result.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        message: 'Component not found in this set or cannot be removed (Missing equipment cannot be detached)'
      });
    }

    // Recalculate set status
    await recalculateSetStatusInternal(setId);

    res.json({
      success: true,
      message: 'Component removed from set'
    });
  } catch (error) {
    console.error('Error removing component from set:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to remove component from set',
      error: error.message
    });
  }
}

// Get PC set statistics
export async function getPCSetStatistics(req, res) {
  try {
    await ensureArchiveRecordsTable();
    const [stats] = await pool.query(`
      SELECT 
        COUNT(DISTINCT es.id) as totalSets,
        SUM(CASE WHEN es.status = 'active' THEN 1 ELSE 0 END) as activeSets,
        SUM(CASE WHEN es.status = 'incomplete' THEN 1 ELSE 0 END) as incompleteSets,
        SUM(CASE WHEN es.status = 'maintenance' THEN 1 ELSE 0 END) as maintenanceSets,
        COUNT(e.id) as totalComponents
      FROM equipment_sets es
      LEFT JOIN equipment e ON e.setId = es.setId
      WHERE NOT EXISTS (
        SELECT 1 FROM archived_records ar
        WHERE ar.entityType = 'pc-set' AND BINARY ar.entityId = BINARY es.setId
      )
    `);

    res.json({
      success: true,
      statistics: stats[0]
    });
  } catch (error) {
    console.error('Error fetching PC set statistics:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch statistics',
      error: error.message
    });
  }
}
