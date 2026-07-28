/**
 * Case Controller
 * 
 * Handles HTTP requests for case management.
 * 
 * The controller:
 * - Extracts data from requests
 * - Calls service methods
 * - Formats and sends responses
 */

const caseService = require('../services/case.service');
const { logger } = require('../utils/logger');

/**
 * Get all cases with pagination and filtering
 * 
 * @route GET /api/v1/cases
 * @access Admin, Supervisor (all cases) | Investigator (assigned only)
 */
async function getCases(req, res) {
  const result = await caseService.getCases(req.query, req.user);
  
  res.json({
    success: true,
    message: 'Cases retrieved successfully',
    data: result.cases,
    pagination: result.pagination
  });
}

/**
 * Get a single case by ID
 * 
 * @route GET /api/v1/cases/:id
 * @access Based on role and assignment
 */
async function getCase(req, res) {
  const { id } = req.params;
  
  const caseData = await caseService.getCaseById(id, req.user);
  
  res.json({
    success: true,
    message: 'Case retrieved successfully',
    data: caseData
  });
}

/**
 * Get a case by case number
 * 
 * @route GET /api/v1/cases/number/:caseNumber
 * @access Based on role and assignment
 */
async function getCaseByCaseNumber(req, res) {
  const { caseNumber } = req.params;
  
  const caseData = await caseService.getCaseByCaseNumber(caseNumber, req.user);
  
  res.json({
    success: true,
    message: 'Case retrieved successfully',
    data: caseData
  });
}

/**
 * Create a new case
 * 
 * @route POST /api/v1/cases
 * @access Admin, Supervisor
 */
async function createCase(req, res) {
  const context = {
    creatorId: req.user.id,
    ipAddress: req.ip
  };
  
  const newCase = await caseService.createCase(req.body, context);
  
  res.status(201).json({
    success: true,
    message: 'Case created successfully',
    data: newCase
  });
}

/**
 * Update a case
 * 
 * @route PUT /api/v1/cases/:id
 * @access Admin, Supervisor, Investigator (limited)
 */
async function updateCase(req, res) {
  const { id } = req.params;
  
  const context = {
    userId: req.user.id,
    userRole: req.user.role,
    ipAddress: req.ip
  };
  
  const updatedCase = await caseService.updateCase(id, req.body, context);
  
  res.json({
    success: true,
    message: 'Case updated successfully',
    data: updatedCase
  });
}

/**
 * Assign an investigator to a case
 * 
 * @route PUT /api/v1/cases/:id/assign
 * @access Admin, Supervisor
 */
async function assignInvestigator(req, res) {
  const { id } = req.params;
  const { investigatorId } = req.body;
  
  const context = {
    userId: req.user.id,
    ipAddress: req.ip
  };
  
  const updatedCase = await caseService.assignInvestigator(id, investigatorId, context);
  
  res.json({
    success: true,
    message: investigatorId 
      ? 'Investigator assigned successfully' 
      : 'Investigator unassigned successfully',
    data: updatedCase
  });
}

/**
 * Close a case
 * 
 * @route POST /api/v1/cases/:id/close
 * @access Admin, Supervisor
 */
async function closeCase(req, res) {
  const { id } = req.params;
  const { reason } = req.body;
  
  const context = {
    userId: req.user.id,
    ipAddress: req.ip
  };
  
  const updatedCase = await caseService.closeCase(id, reason, context);
  
  res.json({
    success: true,
    message: 'Case closed successfully',
    data: updatedCase
  });
}

/**
 * Reopen a closed case
 * 
 * @route POST /api/v1/cases/:id/reopen
 * @access Admin, Supervisor
 */
async function reopenCase(req, res) {
  const { id } = req.params;
  
  const context = {
    userId: req.user.id,
    ipAddress: req.ip
  };
  
  const updatedCase = await caseService.reopenCase(id, context);
  
  res.json({
    success: true,
    message: 'Case reopened successfully',
    data: updatedCase
  });
}

/**
 * Delete a case (soft delete)
 * 
 * @route DELETE /api/v1/cases/:id
 * @access Admin only
 */
async function deleteCase(req, res) {
  const { id } = req.params;
  
  const context = {
    adminId: req.user.id,
    ipAddress: req.ip
  };
  
  const deletedCase = await caseService.deleteCase(id, context);
  
  res.json({
    success: true,
    message: 'Case deleted successfully',
    data: { 
      id: deletedCase.id, 
      caseNumber: deletedCase.caseNumber,
      deletedAt: deletedCase.deletedAt 
    }
  });
}

/**
 * Get case statistics
 * 
 * @route GET /api/v1/cases/statistics
 * @access All authenticated users
 */
async function getStatistics(req, res) {
  const statistics = await caseService.getCaseStatistics(req.user);
  
  res.json({
    success: true,
    message: 'Case statistics retrieved successfully',
    data: statistics
  });
}

module.exports = {
  getCases,
  getCase,
  getCaseByCaseNumber,
  createCase,
  updateCase,
  assignInvestigator,
  closeCase,
  reopenCase,
  deleteCase,
  getStatistics
};
