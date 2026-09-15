// All PDF-related functionality (reading and writing PDF metadata) lives
// in this file. Everything here is built on pdf-lib.
import { PDFDocument } from 'pdf-lib';

/**
 * Extracts the standard metadata fields from a PDF's bytes.
 * @param {ArrayBuffer} arrayBuffer
 * @returns {Promise<{title:string, author:string, subject:string, keywords:string,
 *   creator:string, producer:string, creationDate:string, modificationDate:string, pageCount:number}>}
 * @throws {Error} with a human-readable message if the PDF cannot be read.
 */
export async function extractPdfMetadata(arrayBuffer) {
  let pdfDoc;
  try {
    pdfDoc = await PDFDocument.load(arrayBuffer, { ignoreEncryption: true });
  } catch (err) {
    throw new Error('This file could not be read as a PDF. It may be corrupted or in an unsupported format.');
  }

  return {
    title: pdfDoc.getTitle() || '',
    author: pdfDoc.getAuthor() || '',
    subject: pdfDoc.getSubject() || '',
    keywords: pdfDoc.getKeywords() || '',
    creator: pdfDoc.getCreator() || '',
    producer: pdfDoc.getProducer() || '',
    creationDate: dateToInputValue(pdfDoc.getCreationDate()),
    modificationDate: dateToInputValue(pdfDoc.getModificationDate()),
    pageCount: pdfDoc.getPageCount(),
  };
}

/**
 * Writes a (possibly user-edited) set of metadata fields into a copy of a
 * PDF and returns the new file's bytes. The bytes passed in are never
 * modified in place; a new PDFDocument is loaded and re-saved.
 * @param {ArrayBuffer} arrayBuffer original PDF bytes
 * @param {{title:string, author:string, subject:string, keywords:string, creationDate:string}} metadata
 * @returns {Promise<{bytes: Uint8Array, warning: string|null}>}
 */
export async function applyMetadataAndGetBytes(arrayBuffer, metadata) {
  try {
    const pdfDoc = await PDFDocument.load(arrayBuffer, { ignoreEncryption: true });

    pdfDoc.setTitle(metadata.title || '');
    pdfDoc.setAuthor(metadata.author || '');
    pdfDoc.setSubject(metadata.subject || '');
    pdfDoc.setKeywords(splitKeywords(metadata.keywords));

    const creationDate = parseInputDate(metadata.creationDate);
    if (creationDate) pdfDoc.setCreationDate(creationDate);
    pdfDoc.setModificationDate(new Date());

    const bytes = await pdfDoc.save();
    return { bytes, warning: null };
  } catch (err) {
    return {
      bytes: new Uint8Array(arrayBuffer),
      warning: 'Metadata could not be written into this PDF (it may be encrypted), so the original file content was kept as-is.',
    };
  }
}

/** Splits a free-text keywords string into a clean array for pdf-lib. */
function splitKeywords(keywords) {
  if (!keywords) return [];
  return keywords
    .split(/[,;]/)
    .map((k) => k.trim())
    .filter(Boolean);
}

/** Converts a PDF Date (or undefined) into a value usable by <input type="date">. */
function dateToInputValue(date) {
  if (!date || Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 10);
}

/** Converts a <input type="date"> value back into a Date, or null if invalid/empty. */
function parseInputDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}
