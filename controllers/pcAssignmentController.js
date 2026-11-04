import { sequelize } from '../models/db.js';
import { QueryTypes } from 'sequelize';

const normalizeLabNumber = (value) => {
    const label = String(value || '').trim().toLowerCase();
    const labMatch = label.match(/(?:com\s*lab|laboratory|lab)\s*([12])\b/);
    if (labMatch) return Number(labMatch[1]);
    const roomMatch = label.match(/room\s*(202|204)\b/);
    if (roomMatch) return roomMatch[1] === '202' ? 1 : 2;
    return null;
};

const normalizeCampus = (value) => String(value || '')
    .trim()
    .replace(/\s*campus\s*$/i, '')
    .trim()
    .toLowerCase();

/**
 * Get available PC stations for a laboratory
 * Returns list of PC sets (computer stations) with their availability status
 */
export const getPCAvailability = async (req, res) => {
    try {
        const { campus, laboratory } = req.query;

        const labNumber = laboratory ? normalizeLabNumber(laboratory) : null;
        if (laboratory && !labNumber) {
            return res.status(400).json({ error: 'Unable to determine the laboratory for this PC selection.' });
        }

        // A station belongs to the laboratory recorded on its PC set, not the
        // historical room value of each component assigned to the set.
        let query = `
            SELECT 
                es.setId,
                MIN(e.campus) as campus,
                MIN(e.laboratoryRoom) as laboratoryRoom,
                es.location,
                MIN(e.id) as representativeId,
                MIN(e.equipmentId) as equipmentId,
                MIN(e.name) as name,
                MIN(e.assetNumber) as assetNumber,
                CASE WHEN COUNT(DISTINCT eul.id) > 0 THEN 1 ELSE 0 END as isOccupied,
                GROUP_CONCAT(DISTINCT u.name) as occupiedByName
            FROM equipment_sets es
            INNER JOIN equipment e ON BINARY e.setId = BINARY es.setId
                AND e.status = 'Serviceable'
            LEFT JOIN equipment_usage_logs eul ON e.id = eul.equipmentId
                AND eul.usageEndTime IS NULL
            LEFT JOIN users u ON eul.userId = u.id
            WHERE es.status = 'active'
        `;

        const replacements = [];

        // Add campus filter if provided
        if (campus) {
            const canonicalCampus = normalizeCampus(campus);
            query += ` AND LOWER(TRIM(e.campus)) IN (?, ?)`;
            replacements.push(canonicalCampus, `${canonicalCampus} campus`);
        }

        // Add laboratory filter if provided
        if (labNumber) {
            query += ` AND UPPER(REPLACE(TRIM(es.location), ' ', '')) = ?`;
            replacements.push(`COMLAB${labNumber}`);
        }

        query += ` 
            GROUP BY es.setId, es.location
            ORDER BY es.setId ASC
        `;

        const pcSets = await sequelize.query(query, {
            replacements,
            type: QueryTypes.SELECT
        });

        // Add station numbers (sequential numbering)
        const stations = pcSets.map((set, index) => ({
            id: set.representativeId, // Use first equipment ID as representative
            setId: set.setId,
            equipmentId: set.equipmentId,
            name: set.name || `PC Station ${index + 1}`,
            assetNumber: set.assetNumber,
            campus: set.campus,
            laboratoryRoom: set.laboratoryRoom,
            location: set.location,
            stationNumber: index + 1,
            isOccupied: Boolean(set.isOccupied),
            occupiedByName: set.occupiedByName
        }));

        return res.json({
            success: true,
            pcStations: stations.map(s => ({
                ...s,
                status: s.isOccupied ? 'occupied' : 'available'
            })),
            stations,
            total: stations.length,
            available: stations.filter(s => !s.isOccupied).length,
            occupied: stations.filter(s => s.isOccupied).length
        });

    } catch (error) {
        console.error('Error fetching PC availability:', error);
        return res.status(500).json({ 
            error: 'Failed to fetch PC availability',
            details: error.message 
        });
    }
};

/**
 * Assign a PC to a student
 * Creates an equipment usage log entry
 */
export const assignPC = async (req, res) => {
    try {
        const { 
            attendanceId,
            scheduleId,
            setId,
            equipmentId, 
            userId, 
            campus,
            laboratory 
        } = req.body;

        // Get userId from session if not provided
        const sessionUserId = req.session?.userId;
        const effectiveUserId = userId || sessionUserId;

        // Validate required fields - need either setId or equipmentId
        if (!effectiveUserId) {
            return res.status(400).json({ 
                error: 'User ID is required' 
            });
        }

        if (!setId && !equipmentId) {
            return res.status(400).json({ 
                error: 'Either setId or equipmentId is required' 
            });
        }

        // If setId is provided, get the first equipment in that set
        let targetEquipmentId = equipmentId;
        if (setId && !equipmentId) {
            const equipmentInSet = await sequelize.query(
                `SELECT id FROM equipment WHERE setId = ? AND status = 'Serviceable' ORDER BY category, id LIMIT 1`,
                {
                    replacements: [setId],
                    type: QueryTypes.SELECT
                }
            );

            if (equipmentInSet.length === 0) {
                return res.status(404).json({ 
                    error: 'No equipment found for this PC set' 
                });
            }

            targetEquipmentId = equipmentInSet[0].id;
        }

        const requestedLabNumber = laboratory ? normalizeLabNumber(laboratory) : null;
        if (laboratory && !requestedLabNumber) {
            return res.status(400).json({ error: 'Unable to determine the laboratory for this PC selection.' });
        }

        const station = await sequelize.query(
            `SELECT es.setId, es.location, MIN(e.campus) AS campus
             FROM equipment_sets es
             INNER JOIN equipment e ON BINARY e.setId = BINARY es.setId
             WHERE es.status = 'active'
               AND e.status = 'Serviceable'
               AND ${setId ? 'es.setId = ?' : 'e.id = ?'}
             GROUP BY es.setId, es.location`,
            {
                replacements: [setId || targetEquipmentId],
                type: QueryTypes.SELECT
            }
        );
        if (!station.length) {
            return res.status(404).json({ error: 'The selected PC station is not available.' });
        }
        const selectedSetId = station[0].setId;
        const stationLabNumber = normalizeLabNumber(station[0].location);
        if (
            (requestedLabNumber && stationLabNumber !== requestedLabNumber) ||
            (campus && normalizeCampus(station[0].campus) !== normalizeCampus(campus))
        ) {
            return res.status(409).json({ error: 'Please select a PC station in your selected campus and laboratory.' });
        }

        // Check if PC set is already occupied (check all equipment in the set)
        const setQuery = selectedSetId
            ? `SELECT eul.id, eul.userId, e.setId 
               FROM equipment_usage_logs eul
               JOIN equipment e ON eul.equipmentId = e.id
               WHERE e.setId = ? AND eul.usageEndTime IS NULL`
            : `SELECT id, userId FROM equipment_usage_logs 
               WHERE equipmentId = ? AND usageEndTime IS NULL`;

        const existingUsage = await sequelize.query(
            setQuery,
            {
                replacements: [selectedSetId || targetEquipmentId],
                type: QueryTypes.SELECT
            }
        );

        if (existingUsage.length > 0) {
            return res.status(409).json({ 
                error: 'This PC station is already in use',
                occupiedBy: existingUsage[0].userId
            });
        }

        // Check if user already has an active PC session
        const userActiveSession = await sequelize.query(
            `SELECT id, equipmentId FROM equipment_usage_logs 
             WHERE userId = ? AND usageEndTime IS NULL`,
            {
                replacements: [effectiveUserId],
                type: QueryTypes.SELECT
            }
        );

        if (userActiveSession.length > 0) {
            // End the previous session first
            await sequelize.query(
                `UPDATE equipment_usage_logs 
                 SET usageEndTime = NOW(),
                     durationMinutes = TIMESTAMPDIFF(MINUTE, usageStartTime, NOW())
                 WHERE id = ?`,
                {
                    replacements: [userActiveSession[0].id],
                    type: QueryTypes.UPDATE
                }
            );
        }

        // Get equipment details
        const equipment = await sequelize.query(
            `SELECT serialNumber, campus, laboratoryRoom, setId FROM equipment WHERE id = ?`,
            {
                replacements: [targetEquipmentId],
                type: QueryTypes.SELECT
            }
        );

        const serialNumber = equipment.length > 0 ? equipment[0].serialNumber : null;
        const equipmentSetId = equipment.length > 0 ? equipment[0].setId : setId;
        const equipmentCampus = campus || (equipment.length > 0 ? equipment[0].campus : null);
        const equipmentLab = laboratory || (equipment.length > 0 ? equipment[0].laboratoryRoom : null);

        // Create new usage log entry
        const [result] = await sequelize.query(
            `INSERT INTO equipment_usage_logs 
             (attendanceId, equipmentId, serialNumber, userId, campusId, laboratoryId, pcSetId, usageStartTime)
             VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`,
            {
                replacements: [attendanceId || null, targetEquipmentId, serialNumber, effectiveUserId, equipmentCampus, equipmentLab, equipmentSetId],
                type: QueryTypes.INSERT
            }
        );

        return res.status(201).json({
            success: true,
            message: 'PC assigned successfully',
            usageLogId: result,
            equipmentId: targetEquipmentId,
            setId: equipmentSetId,
            userId: effectiveUserId,
            attendanceId: attendanceId || null,
            scheduleId,
            campus: equipmentCampus,
            laboratory: equipmentLab
        });

    } catch (error) {
        console.error('Error assigning PC:', error);
        return res.status(500).json({ 
            error: 'Failed to assign PC',
            details: error.message 
        });
    }
};

/**
 * End PC usage session
 */
export const endPCSession = async (req, res) => {
    try {
        const { userId, equipmentId } = req.body;

        if (!userId) {
            return res.status(400).json({ error: 'User ID is required' });
        }

        let query = `
            UPDATE equipment_usage_logs 
            SET usageEndTime = NOW(),
                durationMinutes = TIMESTAMPDIFF(MINUTE, usageStartTime, NOW())
            WHERE userId = ? AND usageEndTime IS NULL
        `;
        const params = [userId];

        if (equipmentId) {
            query += ` AND equipmentId = ?`;
            params.push(equipmentId);
        }

        const [, affectedRows] = await sequelize.query(query, {
            replacements: params,
            type: QueryTypes.UPDATE
        });

        if (affectedRows === 0) {
            return res.status(404).json({ 
                error: 'No active PC session found' 
            });
        }

        return res.json({
            success: true,
            message: 'PC session ended successfully',
            sessionsEnded: affectedRows
        });

    } catch (error) {
        console.error('Error ending PC session:', error);
        return res.status(500).json({ 
            error: 'Failed to end PC session',
            details: error.message 
        });
    }
};

/**
 * Get current PC assignment for a user
 */
export const getCurrentPCAssignment = async (req, res) => {
    try {
        const { userId } = req.params;

        if (!userId) {
            return res.status(400).json({ error: 'User ID is required' });
        }

        const assignment = await sequelize.query(
            `SELECT 
                eul.id as usageLogId,
                eul.equipmentId,
               COALESCE(eul.pcSetId, e.setId) as pcSetId,
               eul.usageStartTime,
               e.name as equipmentName,
                e.assetNumber,
                e.laboratoryRoom,
                TIMESTAMPDIFF(MINUTE, eul.usageStartTime, NOW()) as durationMinutes
             FROM equipment_usage_logs eul
             JOIN equipment e ON eul.equipmentId = e.id
             WHERE eul.userId = ? AND eul.usageEndTime IS NULL
             ORDER BY eul.usageStartTime DESC
             LIMIT 1`,
            {
                replacements: [userId],
                type: QueryTypes.SELECT
            }
        );

        if (assignment.length === 0) {
            return res.json({
                success: true,
                hasAssignment: false,
                assignment: null
            });
        }

        return res.json({
            success: true,
            hasAssignment: true,
            assignment: assignment[0]
        });

    } catch (error) {
        console.error('Error fetching current PC assignment:', error);
        return res.status(500).json({ 
            error: 'Failed to fetch current PC assignment',
            details: error.message 
        });
    }
};
