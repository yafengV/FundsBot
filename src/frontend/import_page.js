'use strict';

const importService = require('../import/service');

function toFieldErrors(error) {
  if (!error || typeof error !== 'object') {
    return {};
  }

  if (typeof error.field === 'string' && error.field.trim() !== '') {
    return {
      [error.field]: error.message
    };
  }

  return {
    _form: error.message || 'request failed'
  };
}

function createImportPageModel(input) {
  const state = {
    userId: input.userId,
    ledgers: Array.isArray(input.ledgers) ? input.ledgers : [],
    importBatches: Array.isArray(input.importBatches) ? input.importBatches : [],
    positions: Array.isArray(input.positions) ? input.positions : [],
    positionTxns: Array.isArray(input.positionTxns) ? input.positionTxns : [],
    fundCatalog: input.fundCatalog || {},
    csv: {
      latestValidation: null,
      latestCommit: null
    },
    ocr: {
      latestDraft: null,
      latestConfirm: null
    },
    validation: {
      csvValidate: {},
      csvCommit: {},
      ocrDraft: {},
      ocrConfirm: {}
    },
    flash: null
  };

  const deps = {
    validateCsvImport: input.validateCsvImport || importService.validateCsvImport,
    commitCsvImport: input.commitCsvImport || importService.commitCsvImport,
    createOcrDraft: input.createOcrDraft || importService.createOcrDraft,
    confirmOcrDraft: input.confirmOcrDraft || importService.confirmOcrDraft,
    now: input.now,
    batchIdGenerator: input.batchIdGenerator,
    positionIdGenerator: input.positionIdGenerator,
    txnIdGenerator: input.txnIdGenerator
  };

  function clearValidation(key) {
    state.validation[key] = {};
  }

  function submitCsvValidate(form) {
    clearValidation('csvValidate');
    try {
      const result = deps.validateCsvImport({
        userId: state.userId,
        ledgers: state.ledgers,
        importBatches: state.importBatches,
        fundCatalog: state.fundCatalog,
        now: deps.now,
        batchIdGenerator: deps.batchIdGenerator,
        body: {
          ledgerId: form && form.ledgerId,
          rows: form && form.rows
        }
      });

      state.csv.latestValidation = result;
      state.flash = `CSV validated: ${result.summary.valid}/${result.summary.total} rows valid`;
      return {
        ok: true,
        data: result,
        view: getViewModel()
      };
    } catch (error) {
      state.validation.csvValidate = toFieldErrors(error);
      return {
        ok: false,
        error,
        view: getViewModel()
      };
    }
  }

  function submitCsvCommit(form) {
    clearValidation('csvCommit');
    try {
      const result = deps.commitCsvImport({
        userId: state.userId,
        ledgers: state.ledgers,
        importBatches: state.importBatches,
        positions: state.positions,
        fundCatalog: state.fundCatalog,
        now: deps.now,
        positionIdGenerator: deps.positionIdGenerator,
        body: {
          batchId: (form && form.batchId) || state.csv.latestValidation?.batchId,
          idempotencyKey: form && form.idempotencyKey
        }
      });

      state.csv.latestCommit = result;
      state.flash = `CSV committed: ${result.committedCount} rows`;
      return {
        ok: true,
        data: result,
        view: getViewModel()
      };
    } catch (error) {
      state.validation.csvCommit = toFieldErrors(error);
      return {
        ok: false,
        error,
        view: getViewModel()
      };
    }
  }

  function submitOcrDraft(form) {
    clearValidation('ocrDraft');
    try {
      const result = deps.createOcrDraft({
        userId: state.userId,
        ledgers: state.ledgers,
        importBatches: state.importBatches,
        fundCatalog: state.fundCatalog,
        now: deps.now,
        batchIdGenerator: deps.batchIdGenerator,
        body: {
          ledgerId: form && form.ledgerId,
          lowConfidenceThreshold: form && form.lowConfidenceThreshold,
          rows: form && form.rows
        }
      });

      state.ocr.latestDraft = result;
      state.flash = `OCR draft created: ${result.summary.requiresConfirmation} rows need confirmation`;
      return {
        ok: true,
        data: result,
        view: getViewModel()
      };
    } catch (error) {
      state.validation.ocrDraft = toFieldErrors(error);
      return {
        ok: false,
        error,
        view: getViewModel()
      };
    }
  }

  function submitOcrConfirm(form) {
    clearValidation('ocrConfirm');
    try {
      const result = deps.confirmOcrDraft({
        userId: state.userId,
        ledgers: state.ledgers,
        importBatches: state.importBatches,
        positions: state.positions,
        positionTxns: state.positionTxns,
        fundCatalog: state.fundCatalog,
        now: deps.now,
        positionIdGenerator: deps.positionIdGenerator,
        txnIdGenerator: deps.txnIdGenerator,
        body: {
          batchId: (form && form.batchId) || state.ocr.latestDraft?.batchId,
          idempotencyKey: form && form.idempotencyKey
        }
      });

      state.ocr.latestConfirm = result;
      state.flash = `OCR confirmed: ${result.committedCount} rows`;
      return {
        ok: true,
        data: result,
        view: getViewModel()
      };
    } catch (error) {
      state.validation.ocrConfirm = toFieldErrors(error);
      return {
        ok: false,
        error,
        view: getViewModel()
      };
    }
  }

  function getViewModel() {
    return {
      csv: state.csv,
      ocr: state.ocr,
      validation: state.validation,
      flash: state.flash,
      stats: {
        importBatchCount: state.importBatches.length,
        positionCount: state.positions.length,
        txnCount: state.positionTxns.length
      }
    };
  }

  return {
    submitCsvValidate,
    submitCsvCommit,
    submitOcrDraft,
    submitOcrConfirm,
    getViewModel
  };
}

function renderErrorByField(validation, key, dataError) {
  if (!validation || !validation[key]) {
    return '';
  }

  return `<p data-error="${dataError}">${validation[key]}</p>`;
}

function renderCsvRows(rows) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return '<p data-empty="csv-rows">No CSV rows</p>';
  }

  const items = rows.map((row) => {
    const errorText = (row.errors || []).map((error) => `${error.field}:${error.message}`).join('; ');
    return [
      '<li>',
      `<span data-field="row">Row ${row.rowNumber}</span>`,
      `<span data-field="status">${row.status}</span>`,
      errorText ? `<span data-field="errors">${errorText}</span>` : '',
      '</li>'
    ].join('');
  }).join('');

  return `<ul>${items}</ul>`;
}

function renderOcrRows(rows) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return '<p data-empty="ocr-rows">No OCR rows</p>';
  }

  const items = rows.map((row) => {
    const uncertain = Array.isArray(row.uncertainFields) ? row.uncertainFields.join(',') : '';
    const confirmed = Array.isArray(row.confirmedFields) ? row.confirmedFields.join(',') : '';
    const errorText = (row.errors || []).map((error) => `${error.field}:${error.message}`).join('; ');

    return [
      '<li>',
      `<span data-field="row">Row ${row.rowNumber}</span>`,
      `<span data-field="status">${row.status}</span>`,
      `<span data-field="requires-confirmation">${row.requiresConfirmation ? 'yes' : 'no'}</span>`,
      uncertain ? `<span data-field="uncertain">${uncertain}</span>` : '',
      confirmed ? `<span data-field="confirmed">${confirmed}</span>` : '',
      errorText ? `<span data-field="errors">${errorText}</span>` : '',
      '</li>'
    ].join('');
  }).join('');

  return `<ul>${items}</ul>`;
}

function renderImportPage(view) {
  const csvValidation = view.csv.latestValidation;
  const csvCommit = view.csv.latestCommit;
  const ocrDraft = view.ocr.latestDraft;
  const ocrConfirm = view.ocr.latestConfirm;

  return [
    '<main id="fundsbot-import-page">',
    '<section id="csv-import-panel">',
    '<h1>CSV Import</h1>',
    renderErrorByField(view.validation.csvValidate, 'rows', 'csv-rows'),
    renderErrorByField(view.validation.csvCommit, 'batchId', 'csv-batchId'),
    csvValidation
      ? `<p data-summary="csv">total=${csvValidation.summary.total},valid=${csvValidation.summary.valid},invalid=${csvValidation.summary.invalid}</p>`
      : '<p data-summary="csv">total=0,valid=0,invalid=0</p>',
    csvValidation ? renderCsvRows(csvValidation.rows) : '<p data-empty="csv-validation">No validation yet</p>',
    csvCommit
      ? `<p data-commit="csv">status=${csvCommit.status},committed=${csvCommit.committedCount},failed=${csvCommit.failedCount}</p>`
      : '<p data-commit="csv">status=none</p>',
    '</section>',
    '<section id="ocr-import-panel">',
    '<h2>OCR Confirm</h2>',
    renderErrorByField(view.validation.ocrDraft, 'rows', 'ocr-rows'),
    renderErrorByField(view.validation.ocrConfirm, 'confirmedFields', 'ocr-confirmedFields'),
    ocrDraft
      ? `<p data-summary="ocr">total=${ocrDraft.summary.total},valid=${ocrDraft.summary.valid},invalid=${ocrDraft.summary.invalid},requiresConfirmation=${ocrDraft.summary.requiresConfirmation}</p>`
      : '<p data-summary="ocr">total=0,valid=0,invalid=0,requiresConfirmation=0</p>',
    ocrDraft ? renderOcrRows(ocrDraft.rows) : '<p data-empty="ocr-draft">No draft yet</p>',
    ocrConfirm
      ? `<p data-confirm="ocr">status=${ocrConfirm.status},committed=${ocrConfirm.committedCount},failed=${ocrConfirm.failedCount}</p>`
      : '<p data-confirm="ocr">status=none</p>',
    '</section>',
    `<section id="import-stats"><p data-stats="batches">${view.stats.importBatchCount}</p><p data-stats="positions">${view.stats.positionCount}</p></section>`,
    '</main>'
  ].join('');
}

module.exports = {
  createImportPageModel,
  renderImportPage
};
