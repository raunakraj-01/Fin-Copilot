import multer from 'multer';
import { fail } from '../utils/http.js';

const SPREADSHEET_MIME = {
  csv: new Set(['text/csv', 'application/csv', 'text/plain', 'application/vnd.ms-excel']),
  xlsx: new Set(['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/octet-stream']),
};

const XML_MIME = new Set(['text/xml', 'application/xml', 'text/plain']);

/**
 * Validate an uploaded filename to block null bytes, path traversal, and directory separators.
 */
export function safeUploadFilename(rawName) {
  if (typeof rawName !== 'string' || !rawName.length || rawName.length > 255) {
    fail(400, 'VALIDATION_ERROR', 'Invalid upload filename');
  }
  if (rawName.includes('\0') || rawName.includes('/') || rawName.includes('\\') || rawName.includes('..')) {
    fail(400, 'VALIDATION_ERROR', 'Invalid upload filename');
  }
  return rawName;
}

export function extensionOf(filename) {
  const lower = safeUploadFilename(filename).toLowerCase();
  const dot = lower.lastIndexOf('.');
  return dot > 0 ? lower.slice(dot + 1) : '';
}

export function validateSpreadsheetMeta(file) {
  const ext = extensionOf(file?.originalname);
  if (ext !== 'csv' && ext !== 'xlsx') {
    fail(400, 'VALIDATION_ERROR', 'Upload a CSV or XLSX file');
  }
  if (file.mimetype && !SPREADSHEET_MIME[ext].has(file.mimetype.toLowerCase())) {
    fail(400, 'VALIDATION_ERROR', `Invalid MIME type for ${ext.toUpperCase()} upload`);
  }
  return ext;
}

export function validateXmlMeta(file) {
  const ext = extensionOf(file?.originalname);
  if (ext !== 'xml') {
    fail(400, 'VALIDATION_ERROR', 'Upload a valid .xml file');
  }
  if (file.mimetype && !XML_MIME.has(file.mimetype.toLowerCase())) {
    fail(400, 'VALIDATION_ERROR', 'Invalid MIME type for XML upload');
  }
  return ext;
}

function createMemoryUpload({ maxFileSizeBytes, validator }) {
  return multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: maxFileSizeBytes, files: 1, fields: 10, parts: 12 },
    fileFilter: (_req, file, cb) => {
      try {
        validator(file);
        cb(null, true);
      } catch (err) {
        cb(err);
      }
    },
  });
}

export const createSpreadsheetUpload = (maxBytes = 2 * 1024 * 1024) =>
  createMemoryUpload({ maxFileSizeBytes: maxBytes, validator: validateSpreadsheetMeta });

export const createXmlUpload = (maxBytes = 5 * 1024 * 1024) =>
  createMemoryUpload({ maxFileSizeBytes: maxBytes, validator: validateXmlMeta });
