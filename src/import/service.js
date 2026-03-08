'use strict';

const crypto = require('node:crypto');
const { createPosition } = require('../position/service');
const { withObservedAction } = require('../observability/service');

const ERROR_CODES = {
  FUND_NOT_FOUND: 'FND-1001',
  INVALID_PARAMS: 'FND-1002',
  BUSINESS_RULE: 'FND-1003'
};

const SOURCE_TYPE = 'csv';
const OCR_SOURCE_TYPE = 'ocr';
const SHARES_SCALE = 10000;
const NAV_SCALE = 10000;
const DEFAULT_OCR_LOW_CONFIDENCE_THRESHOLD = 0.95;

function createApiError(code, message, field) {
  const error = new Error(message);
  error.code = code;
  error.field = field;
  return error;
}

function ensureUserId(userId) {
  if (typeof userId !== 'string' || userId.trim() === '') {
    throw createApiError(ERROR_CODES.INVALID_PARAMS, 'userId is required', 'userId');
  }

  return userId.trim();
}

function resolveFund(fundCode, fundCatalog) {
  if (Array.isArray(fundCatalog)) {
    return fundCatalog.find((item) => item && (item.code === fundCode || item.fund_code === fundCode)) || null;
  }

  if (fundCatalog && typeof fundCatalog === 'object') {
    return fundCatalog[fundCode] || null;
  }

  return null;
}

function findUserLedger(ledgers, userId, ledgerId) {
  if (typeof ledgerId !== 'string' || ledgerId.trim() === '') {
    throw createApiError(ERROR_CODES.INVALID_PARAMS, 'ledgerId is required', 'ledgerId');
  }

  const ledger = ledgers.find((item) => item.id === ledgerId && item.user_id === userId && item.is_deleted !== 1);
  if (!ledger) {
    throw createApiError(ERROR_CODES.INVALID_PARAMS, 'ledgerId is invalid', 'ledgerId');
  }

  return ledger;
}

function parseScaledPositiveInteger(value, field, scale) {
  let numericValue;
  if (typeof value === 'number') {
    numericValue = value;
  } else if (typeof value === 'string' && value.trim() !== '') {
    numericValue = Number(value.trim());
  } else {
    throw createApiError(ERROR_CODES.INVALID_PARAMS, `${field} is required`, field);
  }

  if (!Number.isFinite(numericValue) || numericValue <= 0) {
    throw createApiError(ERROR_CODES.INVALID_PARAMS, `${field} must be greater than 0`, field);
  }

  const scaled = Math.round(numericValue * scale);
  const reconstructed = scaled / scale;
  const normalized = Number(numericValue.toFixed(8));

  if (Math.abs(normalized - reconstructed) > 0.0000001) {
    throw createApiError(ERROR_CODES.INVALID_PARAMS, `${field} precision exceeds scale`, field);
  }

  return scaled;
}

function normalizeFundCode(rawFundCode) {
  if (typeof rawFundCode !== 'string' || rawFundCode.trim() === '') {
    throw createApiError(ERROR_CODES.INVALID_PARAMS, 'fundCode is required', 'fundCode');
  }

  return rawFundCode.trim();
}

function parseRows(inputRows) {
  if (!Array.isArray(inputRows)) {
    throw createApiError(ERROR_CODES.INVALID_PARAMS, 'rows must be an array', 'rows');
  }

  return inputRows;
}

function parseOptionalIdempotencyKey(raw) {
  if (raw === undefined || raw === null) {
    return null;
  }

  if (typeof raw !== 'string' || raw.trim() === '') {
    throw createApiError(ERROR_CODES.INVALID_PARAMS, 'idempotencyKey must be a non-empty string', 'idempotencyKey');
  }

  return raw.trim();
}

function normalizeRow(input) {
  const bodyLedgerId = typeof input.bodyLedgerId === 'string' && input.bodyLedgerId.trim() !== ''
    ? input.bodyLedgerId.trim()
    : null;
  const rowLedgerId = typeof input.row.ledgerId === 'string' && input.row.ledgerId.trim() !== ''
    ? input.row.ledgerId.trim()
    : null;
  const ledgerId = bodyLedgerId || rowLedgerId;

  findUserLedger(input.ledgers, input.userId, ledgerId);

  const fundCode = normalizeFundCode(input.row.fundCode);
  if (!resolveFund(fundCode, input.fundCatalog)) {
    throw createApiError(ERROR_CODES.FUND_NOT_FOUND, 'fundCode does not exist', 'fundCode');
  }

  parseScaledPositiveInteger(input.row.shares, 'shares', SHARES_SCALE);
  parseScaledPositiveInteger(input.row.costNav, 'costNav', NAV_SCALE);

  return {
    ledgerId,
    fundCode,
    shares: Number(input.row.shares),
    costNav: Number(input.row.costNav)
  };
}

function buildChecksumPayload(validRows, resultRows) {
  return {
    validRows,
    resultRows: resultRows.map((item) => ({
      rowNumber: item.rowNumber,
      status: item.status,
      errors: item.errors.map((error) => ({
        code: error.code,
        field: error.field,
        message: error.message
      }))
    }))
  };
}

function computeChecksum(payload) {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(payload))
    .digest('hex');
}

function buildValidateSummary(rows) {
  const total = rows.length;
  const invalid = rows.filter((item) => item.status === 'invalid').length;
  const valid = total - invalid;

  return {
    total,
    valid,
    invalid
  };
}

function validateCsvImport(input) {
  const userId = ensureUserId(input.userId);
  const ledgers = Array.isArray(input.ledgers) ? input.ledgers : [];
  const importBatches = Array.isArray(input.importBatches) ? input.importBatches : [];
  const body = input.body || {};
  const rows = parseRows(body.rows || input.rows);
  const bodyLedgerId = typeof body.ledgerId === 'string' ? body.ledgerId : null;

  const resultRows = [];
  const validRows = [];

  rows.forEach((row, index) => {
    const rowNumber = Number.isInteger(row?.rowNumber) ? row.rowNumber : index + 1;

    try {
      const normalized = normalizeRow({
        userId,
        ledgers,
        fundCatalog: input.fundCatalog,
        bodyLedgerId,
        row: row || {}
      });

      validRows.push(normalized);
      resultRows.push({
        rowNumber,
        status: 'valid',
        errors: []
      });
    } catch (error) {
      resultRows.push({
        rowNumber,
        status: 'invalid',
        errors: [
          {
            code: error.code || ERROR_CODES.INVALID_PARAMS,
            field: error.field || 'row',
            message: error.message || 'row is invalid'
          }
        ]
      });
    }
  });

  const summary = buildValidateSummary(resultRows);
  const checksum = computeChecksum(buildChecksumPayload(validRows, resultRows));
  const now = typeof input.now === 'function' ? input.now() : new Date().toISOString();
  const batchId = typeof input.batchIdGenerator === 'function'
    ? input.batchIdGenerator()
    : `import-${Date.now().toString(36)}`;

  const batch = {
    id: batchId,
    user_id: userId,
    source_type: SOURCE_TYPE,
    status: 'validated',
    validation_checksum: checksum,
    row_total: summary.total,
    row_success: summary.valid,
    row_failed: summary.invalid,
    error_payload: JSON.stringify(
      resultRows
        .filter((item) => item.status === 'invalid')
        .map((item) => ({ rowNumber: item.rowNumber, errors: item.errors }))
    ),
    created_at: now,
    updated_at: now,
    validated_rows: validRows,
    result_rows: resultRows,
    committed_position_ids: [],
    commit_idempotency_key: null
  };

  importBatches.push(batch);

  return {
    batchId: batch.id,
    validationChecksum: batch.validation_checksum,
    summary,
    rows: resultRows
  };
}

function parseBatchId(raw) {
  if (typeof raw !== 'string' || raw.trim() === '') {
    throw createApiError(ERROR_CODES.INVALID_PARAMS, 'batchId is required', 'batchId');
  }

  return raw.trim();
}

function isCommittedStatus(status) {
  return status === 'committed' || status === 'partial_failed';
}

function toCommitResponse(batch, idempotent, reason) {
  return {
    batchId: batch.id,
    status: batch.status,
    committedCount: batch.row_success,
    failedCount: batch.row_failed,
    committedPositionIds: Array.isArray(batch.committed_position_ids) ? batch.committed_position_ids : [],
    validationChecksum: batch.validation_checksum,
    idempotent,
    reason
  };
}

function findBatch(importBatches, userId, batchId) {
  return importBatches.find((item) => {
    return item.id === batchId && item.user_id === userId && (item.source_type === SOURCE_TYPE || item.source_type === OCR_SOURCE_TYPE);
  });
}

function commitCsvImport(input) {
  const userId = ensureUserId(input.userId);
  const importBatches = Array.isArray(input.importBatches) ? input.importBatches : [];
  const positions = Array.isArray(input.positions) ? input.positions : [];
  const ledgers = Array.isArray(input.ledgers) ? input.ledgers : [];
  const body = input.body || {};

  const batchId = parseBatchId(body.batchId || input.batchId);
  const idempotencyKey = parseOptionalIdempotencyKey(body.idempotencyKey || input.idempotencyKey);
  const batch = findBatch(importBatches, userId, batchId);

  if (!batch) {
    throw createApiError(ERROR_CODES.INVALID_PARAMS, 'batchId is invalid', 'batchId');
  }

  const duplicateByChecksum = importBatches.find((item) => {
    return item.id !== batch.id
      && item.user_id === userId
      && item.source_type === SOURCE_TYPE
      && item.validation_checksum === batch.validation_checksum
      && isCommittedStatus(item.status);
  });

  if (duplicateByChecksum) {
    return toCommitResponse(duplicateByChecksum, true, 'checksum_duplicate');
  }

  if (isCommittedStatus(batch.status)) {
    if (idempotencyKey && batch.commit_idempotency_key && idempotencyKey !== batch.commit_idempotency_key) {
      throw createApiError(ERROR_CODES.BUSINESS_RULE, 'idempotencyKey conflicts with committed batch', 'idempotencyKey');
    }

    return toCommitResponse(batch, true, 'already_committed');
  }

  if (batch.status !== 'validated') {
    throw createApiError(ERROR_CODES.BUSINESS_RULE, 'batch status does not allow commit', 'batchId');
  }

  const validRows = Array.isArray(batch.validated_rows) ? batch.validated_rows : [];
  const committedPositionIds = [];

  validRows.forEach((row) => {
    const created = createPosition({
      userId,
      ledgers,
      positions,
      fundCatalog: input.fundCatalog,
      body: {
        ledgerId: row.ledgerId,
        fundCode: row.fundCode,
        shares: row.shares,
        costNav: row.costNav
      },
      now: input.now,
      idGenerator: input.positionIdGenerator
    });

    committedPositionIds.push(created.id);
  });

  const now = typeof input.now === 'function' ? input.now() : new Date().toISOString();
  batch.row_success = committedPositionIds.length;
  batch.row_failed = Math.max(0, (batch.row_total || 0) - committedPositionIds.length);
  batch.status = batch.row_failed > 0 ? 'partial_failed' : 'committed';
  batch.updated_at = now;
  batch.commit_idempotency_key = idempotencyKey;
  batch.committed_position_ids = committedPositionIds;

  return toCommitResponse(batch, false, null);
}

function parseConfidenceValue(value, field) {
  if (value === undefined || value === null || value === '') {
    return 1;
  }

  const numericValue = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numericValue) || numericValue < 0 || numericValue > 1) {
    throw createApiError(ERROR_CODES.INVALID_PARAMS, `${field} confidence must be between 0 and 1`, field);
  }

  return numericValue;
}

function parseConfirmedFields(raw) {
  if (raw === undefined || raw === null) {
    return [];
  }

  if (!Array.isArray(raw)) {
    throw createApiError(ERROR_CODES.INVALID_PARAMS, 'confirmedFields must be an array', 'confirmedFields');
  }

  const output = [];
  raw.forEach((item) => {
    if (typeof item !== 'string' || item.trim() === '') {
      throw createApiError(ERROR_CODES.INVALID_PARAMS, 'confirmedFields must contain non-empty strings', 'confirmedFields');
    }

    const normalized = item.trim();
    if (!output.includes(normalized)) {
      output.push(normalized);
    }
  });

  return output;
}

function parseOcrThreshold(input) {
  const raw = input.body?.lowConfidenceThreshold ?? input.lowConfidenceThreshold;
  if (raw === undefined || raw === null || raw === '') {
    return DEFAULT_OCR_LOW_CONFIDENCE_THRESHOLD;
  }

  const numericValue = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(numericValue) || numericValue < 0 || numericValue > 1) {
    throw createApiError(ERROR_CODES.INVALID_PARAMS, 'lowConfidenceThreshold must be between 0 and 1', 'lowConfidenceThreshold');
  }

  return numericValue;
}

function buildOcrRow(input) {
  const bodyLedgerId = typeof input.bodyLedgerId === 'string' && input.bodyLedgerId.trim() !== ''
    ? input.bodyLedgerId.trim()
    : null;
  const rowLedgerId = typeof input.row.ledgerId === 'string' && input.row.ledgerId.trim() !== ''
    ? input.row.ledgerId.trim()
    : null;
  const ledgerId = bodyLedgerId || rowLedgerId;

  findUserLedger(input.ledgers, input.userId, ledgerId);

  const fundCode = normalizeFundCode(input.row.fundCode);
  if (!resolveFund(fundCode, input.fundCatalog)) {
    throw createApiError(ERROR_CODES.FUND_NOT_FOUND, 'fundCode does not exist', 'fundCode');
  }

  const sharesX10000 = parseScaledPositiveInteger(input.row.shares, 'shares', SHARES_SCALE);
  const costNavX10000 = parseScaledPositiveInteger(input.row.costNav, 'costNav', NAV_SCALE);
  const confidence = input.row.confidence || {};
  const confidenceByField = {
    fundCode: parseConfidenceValue(confidence.fundCode, 'fundCode'),
    shares: parseConfidenceValue(confidence.shares, 'shares'),
    costNav: parseConfidenceValue(confidence.costNav, 'costNav')
  };
  const uncertainFields = Object.keys(confidenceByField).filter((field) => {
    return confidenceByField[field] < input.lowConfidenceThreshold;
  });
  const confirmedFields = parseConfirmedFields(input.row.confirmedFields);
  const missingConfirmations = uncertainFields.filter((field) => !confirmedFields.includes(field));

  return {
    ledgerId,
    fundCode,
    shares: Number(input.row.shares),
    costNav: Number(input.row.costNav),
    sharesX10000,
    costNavX10000,
    confidence: confidenceByField,
    uncertainFields,
    confirmedFields,
    isConfirmed: missingConfirmations.length === 0
  };
}

function toOcrDraftRowResult(rowNumber, draftRow) {
  return {
    rowNumber,
    status: 'valid',
    confidence: draftRow.confidence,
    uncertainFields: draftRow.uncertainFields,
    confirmedFields: draftRow.confirmedFields,
    requiresConfirmation: draftRow.uncertainFields.length > 0,
    isConfirmed: draftRow.isConfirmed,
    errors: []
  };
}

function createOcrDraft(input) {
  const userId = ensureUserId(input.userId);
  const ledgers = Array.isArray(input.ledgers) ? input.ledgers : [];
  const importBatches = Array.isArray(input.importBatches) ? input.importBatches : [];
  const body = input.body || {};
  const rows = parseRows(body.rows || input.rows);
  const bodyLedgerId = typeof body.ledgerId === 'string' ? body.ledgerId : null;
  const lowConfidenceThreshold = parseOcrThreshold(input);
  const draftRows = [];
  const resultRows = [];

  rows.forEach((row, index) => {
    const rowNumber = Number.isInteger(row?.rowNumber) ? row.rowNumber : index + 1;

    try {
      const draftRow = buildOcrRow({
        userId,
        ledgers,
        fundCatalog: input.fundCatalog,
        bodyLedgerId,
        row: row || {},
        lowConfidenceThreshold
      });
      draftRows.push(draftRow);
      resultRows.push(toOcrDraftRowResult(rowNumber, draftRow));
    } catch (error) {
      resultRows.push({
        rowNumber,
        status: 'invalid',
        confidence: null,
        uncertainFields: [],
        confirmedFields: [],
        requiresConfirmation: false,
        isConfirmed: false,
        errors: [
          {
            code: error.code || ERROR_CODES.INVALID_PARAMS,
            field: error.field || 'row',
            message: error.message || 'row is invalid'
          }
        ]
      });
    }
  });

  const summary = buildValidateSummary(resultRows);
  const requiresConfirmation = resultRows.filter((row) => row.requiresConfirmation).length;
  const checksum = computeChecksum({
    lowConfidenceThreshold,
    draftRows: draftRows.map((row) => ({
      ledgerId: row.ledgerId,
      fundCode: row.fundCode,
      shares: row.shares,
      costNav: row.costNav,
      confidence: row.confidence
    }))
  });
  const now = typeof input.now === 'function' ? input.now() : new Date().toISOString();
  const batchId = typeof input.batchIdGenerator === 'function'
    ? input.batchIdGenerator()
    : `import-${Date.now().toString(36)}`;

  const batch = {
    id: batchId,
    user_id: userId,
    source_type: OCR_SOURCE_TYPE,
    status: 'validated',
    validation_checksum: checksum,
    row_total: summary.total,
    row_success: summary.valid,
    row_failed: summary.invalid,
    error_payload: JSON.stringify(
      resultRows
        .filter((item) => item.status === 'invalid')
        .map((item) => ({ rowNumber: item.rowNumber, errors: item.errors }))
    ),
    created_at: now,
    updated_at: now,
    draft_rows: draftRows,
    result_rows: resultRows,
    committed_position_ids: [],
    commit_idempotency_key: null,
    low_confidence_threshold: lowConfidenceThreshold
  };

  importBatches.push(batch);

  return {
    batchId: batch.id,
    summary: {
      total: summary.total,
      valid: summary.valid,
      invalid: summary.invalid,
      requiresConfirmation
    },
    rows: resultRows
  };
}

function toOcrCommitResponse(batch, idempotent, reason) {
  return {
    batchId: batch.id,
    status: batch.status,
    committedCount: batch.row_success,
    failedCount: batch.row_failed,
    committedPositionIds: Array.isArray(batch.committed_position_ids) ? batch.committed_position_ids : [],
    idempotent,
    reason
  };
}

function createImportTxn(input) {
  const now = typeof input.now === 'function' ? input.now() : new Date().toISOString();
  const id = typeof input.txnIdGenerator === 'function'
    ? input.txnIdGenerator()
    : `txn-${Date.now().toString(36)}`;

  return {
    id,
    position_id: input.positionId,
    ledger_id: input.ledgerId,
    txn_type: 'create',
    shares_delta_x10000: input.sharesX10000,
    amount_delta_cents: input.amountDeltaCents,
    idempotency_key: input.idempotencyKey || null,
    occurred_at: now,
    created_at: now,
    import_batch_id: input.batchId
  };
}

function confirmOcrDraft(input) {
  const userId = ensureUserId(input.userId);
  const importBatches = Array.isArray(input.importBatches) ? input.importBatches : [];
  const positions = Array.isArray(input.positions) ? input.positions : [];
  const positionTxns = Array.isArray(input.positionTxns) ? input.positionTxns : [];
  const ledgers = Array.isArray(input.ledgers) ? input.ledgers : [];
  const body = input.body || {};
  const batchId = parseBatchId(body.batchId || input.batchId);
  const idempotencyKey = parseOptionalIdempotencyKey(body.idempotencyKey || input.idempotencyKey);
  const batch = findBatch(importBatches, userId, batchId);

  if (!batch || batch.source_type !== OCR_SOURCE_TYPE) {
    throw createApiError(ERROR_CODES.INVALID_PARAMS, 'batchId is invalid', 'batchId');
  }

  const duplicateByChecksum = importBatches.find((item) => {
    return item.id !== batch.id
      && item.user_id === userId
      && item.source_type === OCR_SOURCE_TYPE
      && item.validation_checksum === batch.validation_checksum
      && isCommittedStatus(item.status);
  });

  if (duplicateByChecksum) {
    return toOcrCommitResponse(duplicateByChecksum, true, 'checksum_duplicate');
  }

  if (isCommittedStatus(batch.status)) {
    if (idempotencyKey && batch.commit_idempotency_key && idempotencyKey !== batch.commit_idempotency_key) {
      throw createApiError(ERROR_CODES.BUSINESS_RULE, 'idempotencyKey conflicts with committed batch', 'idempotencyKey');
    }

    return toOcrCommitResponse(batch, true, 'already_committed');
  }

  if (batch.status !== 'validated') {
    throw createApiError(ERROR_CODES.BUSINESS_RULE, 'batch status does not allow confirm', 'batchId');
  }

  const draftRows = Array.isArray(batch.draft_rows) ? batch.draft_rows : [];
  const unconfirmedRow = draftRows.find((row) => row.isConfirmed !== true);
  if (unconfirmedRow) {
    throw createApiError(ERROR_CODES.BUSINESS_RULE, 'ocr draft has unconfirmed fields', 'confirmedFields');
  }

  const committedPositionIds = [];
  draftRows.forEach((row) => {
    const created = createPosition({
      userId,
      ledgers,
      positions,
      fundCatalog: input.fundCatalog,
      body: {
        ledgerId: row.ledgerId,
        fundCode: row.fundCode,
        shares: row.shares,
        costNav: row.costNav
      },
      now: input.now,
      idGenerator: input.positionIdGenerator
    });
    committedPositionIds.push(created.id);
    positionTxns.push(createImportTxn({
      positionId: created.id,
      ledgerId: row.ledgerId,
      sharesX10000: row.sharesX10000,
      amountDeltaCents: created.investedCents,
      idempotencyKey,
      now: input.now,
      txnIdGenerator: input.txnIdGenerator,
      batchId: batch.id
    }));
  });

  const now = typeof input.now === 'function' ? input.now() : new Date().toISOString();
  batch.row_success = committedPositionIds.length;
  batch.row_failed = Math.max(0, (batch.row_total || 0) - committedPositionIds.length);
  batch.status = batch.row_failed > 0 ? 'partial_failed' : 'committed';
  batch.updated_at = now;
  batch.commit_idempotency_key = idempotencyKey;
  batch.committed_position_ids = committedPositionIds;

  return toOcrCommitResponse(batch, false, null);
}

function observe(action, handler) {
  return function observed(input) {
    return withObservedAction({
      input,
      action,
      run: () => handler(input)
    });
  };
}

module.exports = {
  ERROR_CODES,
  validateCsvImport: observe('import.validate_csv', validateCsvImport),
  commitCsvImport: observe('import.commit_csv', commitCsvImport),
  createOcrDraft: observe('import.ocr_draft', createOcrDraft),
  confirmOcrDraft: observe('import.ocr_confirm', confirmOcrDraft)
};
