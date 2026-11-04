/**
 * Inventory Check Controller
 * Manages weekly equipment inventory checks
 */

import EquipmentInventoryCheck from '../models/equipmentInventoryCheckModel.js';
import EquipmentInventoryCheckItem from '../models/equipmentInventoryCheckItemModel.js';
import { Equipment } from '../models/equipmentModel.js';
import { Op, QueryTypes } from 'sequelize';
import { sequelize } from '../models/db.js';
import { formatComputerLabLocation } from '../models/computerLabService.js';

async function addComputerLabNames(checks) {
    const checkList = Array.isArray(checks) ? checks : [checks];
    const labIds = [...new Set(checkList.map((check) => Number(check?.computerLabId || 0)).filter(Boolean))];
    if (!labIds.length) return checkList;
    const labs = await sequelize.query(
        'SELECT id, name, roomNumber FROM computer_labs WHERE id IN (:labIds)',
        { replacements: { labIds }, type: QueryTypes.SELECT }
    );
    const names = new Map(labs.map((lab) => [String(lab.id), formatComputerLabLocation(lab)]));
    return checkList.map((check) => ({
        ...check.toJSON(),
        computerLabName: names.get(String(check.computerLabId)) || null
    }));
}

/**
 * Generate check ID based on date
 * Format: INV-YYYY-WXX (e.g., INV-2026-W40)
 */
function generateCheckId(date = new Date()) {
    const year = date.getFullYear();
    
    // Calculate week number
    const firstDayOfYear = new Date(year, 0, 1);
    const pastDaysOfYear = (date - firstDayOfYear) / 86400000;
    const weekNumber = Math.ceil((pastDaysOfYear + firstDayOfYear.getDay() + 1) / 7);
    
    return `INV-${year}-W${String(weekNumber).padStart(2, '0')}`;
}

/**
 * Get all inventory checks
 */
async function getAllChecks(req, res) {
    try {
        const { campusId, laboratoryId, status, startDate, endDate } = req.query;
        
        const whereClause = {};
        if (campusId) whereClause.campusId = campusId;
        if (laboratoryId) whereClause.laboratoryId = laboratoryId;
        if (status) whereClause.status = status;
        
        if (startDate || endDate) {
            whereClause.checkDate = {};
            if (startDate) whereClause.checkDate[Op.gte] = startDate;
            if (endDate) whereClause.checkDate[Op.lte] = endDate;
        }
        
        const checks = await EquipmentInventoryCheck.findAll({
            where: whereClause,
            order: [['checkDate', 'DESC']]
        });
        
        res.json({
            success: true,
            checks: await addComputerLabNames(checks)
        });
        
    } catch (error) {
        console.error('Error fetching inventory checks:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch inventory checks',
            error: error.message
        });
    }
}

/**
 * Get single inventory check with items
 */
async function getCheckById(req, res) {
    try {
        const { id } = req.params;
        
        const check = await EquipmentInventoryCheck.findOne({
            where: {
                [Op.or]: [
                    { id: id },
                    { checkId: id }
                ]
            }
        });
        
        if (!check) {
            return res.status(404).json({
                success: false,
                message: 'Inventory check not found'
            });
        }
        
        // Get all items in this check
        const items = await EquipmentInventoryCheckItem.findAll({
            where: { inventoryCheckId: check.id },
            order: [['checkedAt', 'ASC']]
        });
        
        const [enrichedCheck] = await addComputerLabNames([check]);
        res.json({
            success: true,
            check: {
                ...enrichedCheck,
                items
            }
        });
        
    } catch (error) {
        console.error('Error fetching inventory check:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch inventory check',
            error: error.message
        });
    }
}

/**
 * Create new inventory check
 */
async function createCheck(req, res) {
    try {
        const {
            checkDate,
            campusId,
            laboratoryId,
            notes
        } = req.body;
        
        // Validate required fields
        if (!campusId) {
            return res.status(400).json({
                success: false,
                message: 'Campus ID is required'
            });
        }
        
        const date = checkDate ? new Date(checkDate) : new Date();
        const checkId = generateCheckId(date);
        
        // Check if check already exists for this week
        const existingCheck = await EquipmentInventoryCheck.findOne({
            where: { checkId }
        });
        
        if (existingCheck) {
            return res.status(400).json({
                success: false,
                message: `Inventory check already exists for this week: ${checkId}`
            });
        }
        
        // Count expected equipment
        const campusValue = String(campusId).trim();
        const campusName = campusValue.replace(/\s*Campus\s*$/i, '').trim();
        const campusVariants = [...new Set([campusValue, campusName, `${campusName} Campus`])];
        const whereClause = { campus: { [Op.in]: campusVariants } };
        if (laboratoryId) whereClause.laboratoryRoom = laboratoryId;

        const totalExpected = await Equipment.count({ where: whereClause });
        const sessionUserId = req.session?.userId || req.user?.id;
        const sessionUserName = req.session?.userName || req.user?.name || req.user?.email || 'Technician';
        if (!sessionUserId) {
            return res.status(401).json({ success: false, message: 'Please log in before creating an inventory check.' });
        }
        
        // Create check
        const newCheck = await EquipmentInventoryCheck.create({
            checkId,
            checkDate: date,
            campusId: campusValue,
            laboratoryId,
            performedBy: sessionUserId,
            performedByName: sessionUserName,
            status: 'in_progress',
            totalItemsExpected: totalExpected,
            totalItemsFound: 0,
            missingCount: 0,
            damagedCount: 0,
            notes
        });
        
        res.status(201).json({
            success: true,
            message: 'Inventory check created successfully',
            check: newCheck
        });
        
    } catch (error) {
        console.error('Error creating inventory check:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to create inventory check',
            error: error.message
        });
    }
}

/**
 * Add item to inventory check
 */
async function addCheckItem(req, res) {
    try {
        const { checkId } = req.params;
        const {
            equipmentId,
            serialNumber,
            expectedLocation,
            actualLocation,
            status,
            conditionBefore,
            conditionAfter,
            notes
        } = req.body;
        
        // Find check
        const check = await EquipmentInventoryCheck.findOne({
            where: {
                [Op.or]: [
                    { id: checkId },
                    { checkId: checkId }
                ]
            }
        });
        
        if (!check) {
            return res.status(404).json({
                success: false,
                message: 'Inventory check not found'
            });
        }
        
        if (check.status === 'completed' || check.status === 'reviewed') {
            return res.status(400).json({
                success: false,
                message: 'Cannot add items to completed inventory check'
            });
        }
        
        // Validate required fields
        if (!equipmentId && !serialNumber) {
            return res.status(400).json({
                success: false,
                message: 'Equipment ID or serial number is required'
            });
        }
        
        if (!status) {
            return res.status(400).json({
                success: false,
                message: 'Status is required (found, missing, damaged, misplaced)'
            });
        }

        const equipment = equipmentId
            ? await Equipment.findByPk(equipmentId)
            : await Equipment.findOne({ where: { serialNumber } });
        if (!equipment) return res.status(404).json({ success: false, message: 'Equipment was not found.' });

        const existingItem = await EquipmentInventoryCheckItem.findOne({
            where: { inventoryCheckId: check.id, equipmentId: equipment.id }
        });

        // Create check item
        const itemData = {
            inventoryCheckId: check.id,
            equipmentId: equipment.id,
            serialNumber: serialNumber || equipment.serialNumber || null,
            expectedLocation,
            actualLocation,
            status,
            conditionBefore,
            conditionAfter,
            notes
        };
        const item = existingItem
            ? await existingItem.update(itemData)
            : await EquipmentInventoryCheckItem.create(itemData);
        
        // Update check summary
        const items = await EquipmentInventoryCheckItem.findAll({
            where: { inventoryCheckId: check.id }
        });
        
        const foundCount = items.filter(i => i.status === 'found').length;
        const missingCount = items.filter(i => i.status === 'missing').length;
        const damagedCount = items.filter(i => i.status === 'damaged').length;
        
        await check.update({
            totalItemsFound: foundCount,
            missingCount,
            damagedCount
        });
        
        // Update equipment condition if changed
        if (equipmentId && conditionAfter && conditionAfter !== conditionBefore) {
            await Equipment.update(
                { condition: conditionAfter },
                { where: { id: equipmentId } }
            );
        }
        
        res.status(201).json({
            success: true,
            message: 'Check item added successfully',
            item
        });
        
    } catch (error) {
        console.error('Error adding check item:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to add check item',
            error: error.message
        });
    }
}

/**
 * Complete inventory check
 */
async function completeCheck(req, res) {
    try {
        const { id } = req.params;
        const { notes } = req.body;
        
        const check = await EquipmentInventoryCheck.findByPk(id);
        
        if (!check) {
            return res.status(404).json({
                success: false,
                message: 'Inventory check not found'
            });
        }
        
        if (check.status !== 'in_progress') {
            return res.status(400).json({
                success: false,
                message: 'Only in-progress checks can be completed'
            });
        }

        const checkedCount = await EquipmentInventoryCheckItem.count({
            where: { inventoryCheckId: check.id }
        });
        if (Number(check.totalItemsExpected || 0) > checkedCount) {
            return res.status(400).json({
                success: false,
                message: `Complete all equipment rows before finishing this check. ${Number(check.totalItemsExpected) - checkedCount} item(s) remain unchecked.`
            });
        }
        
        await check.update({
            status: 'completed',
            completedAt: new Date(),
            notes: notes || check.notes
        });
        
        res.json({
            success: true,
            message: 'Inventory check completed successfully',
            check
        });
        
    } catch (error) {
        console.error('Error completing inventory check:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to complete inventory check',
            error: error.message
        });
    }
}

/**
 * Review inventory check (admin only)
 */
async function reviewCheck(req, res) {
    try {
        const { id } = req.params;
        
        const check = await EquipmentInventoryCheck.findByPk(id);
        
        if (!check) {
            return res.status(404).json({
                success: false,
                message: 'Inventory check not found'
            });
        }
        
        if (check.status !== 'completed') {
            return res.status(400).json({
                success: false,
                message: 'Only completed checks can be reviewed'
            });
        }
        
        await check.update({
            status: 'reviewed',
            reviewedBy: req.session?.userId || req.user?.id,
            reviewedAt: new Date()
        });
        
        res.json({
            success: true,
            message: 'Inventory check reviewed successfully',
            check
        });
        
    } catch (error) {
        console.error('Error reviewing inventory check:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to review inventory check',
            error: error.message
        });
    }
}

/**
 * Get inventory statistics
 */
async function getInventoryStats(req, res) {
    try {
        const { campusId, startDate, endDate } = req.query;
        
        const whereClause = {};
        if (campusId) whereClause.campusId = campusId;
        
        if (startDate || endDate) {
            whereClause.checkDate = {};
            if (startDate) whereClause.checkDate[Op.gte] = startDate;
            if (endDate) whereClause.checkDate[Op.lte] = endDate;
        }
        
        const checks = await EquipmentInventoryCheck.findAll({
            where: whereClause,
            attributes: ['totalItemsExpected', 'totalItemsFound', 'missingCount', 'damagedCount']
        });
        
        const stats = {
            totalChecks: checks.length,
            totalItemsExpected: checks.reduce((sum, c) => sum + (c.totalItemsExpected || 0), 0),
            totalItemsFound: checks.reduce((sum, c) => sum + (c.totalItemsFound || 0), 0),
            totalMissing: checks.reduce((sum, c) => sum + (c.missingCount || 0), 0),
            totalDamaged: checks.reduce((sum, c) => sum + (c.damagedCount || 0), 0)
        };
        
        stats.foundPercentage = stats.totalItemsExpected > 0
            ? ((stats.totalItemsFound / stats.totalItemsExpected) * 100).toFixed(2)
            : 0;
        
        res.json({
            success: true,
            stats
        });
        
    } catch (error) {
        console.error('Error fetching inventory stats:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch inventory statistics',
            error: error.message
        });
    }
}

export {
    getAllChecks,
    getCheckById,
    createCheck,
    addCheckItem,
    completeCheck,
    reviewCheck,
    getInventoryStats
};
