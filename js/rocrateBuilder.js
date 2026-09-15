// All RO-Crate construction and validation lives in this file, built on
// the "ro-crate" library. Nothing here knows how to read or write PDFs.
import { ROCrate } from 'ro-crate';

const RO_CRATE_VERSION = '1.3';
const RO_CRATE_SPEC_URI = `https://w3id.org/ro/crate/${RO_CRATE_VERSION}`;
const RO_CRATE_CONTEXT_URI = `${RO_CRATE_SPEC_URI}/context`;

/** Fields on the crate (root dataset) required by the RO-Crate 1.3 spec. */
export const REQUIRED_CRATE_FIELDS = ['name', 'description', 'datePublished', 'license'];

/**
 * Fields on each File entity required by this app. The RO-Crate 1.3 spec's
 * "Core Metadata for Data Entities" only strictly requires @id/@type, but
 * recommends name, description, encodingFormat and contentSize for File
 * entities (https://www.researchobject.org/ro-crate/specification/1.3/data-entities.html) —
 * this app enforces all four so every generated crate carries them.
 */
export const REQUIRED_FILE_FIELDS = ['name', 'description', 'encodingFormat', 'contentSize'];

/**
 * @param {{name:string, description:string, datePublished:string, license:string}} crateMeta
 * @returns {string[]} human-readable messages for any missing required fields; empty when valid.
 */
export function validateCrateMetadata(crateMeta) {
  const messages = [];
  if (!crateMeta.name?.trim()) messages.push('Crate name is required.');
  if (!crateMeta.description?.trim()) messages.push('Crate description is required.');
  if (!crateMeta.datePublished?.trim()) messages.push('Crate publication date is required.');
  if (!crateMeta.license?.trim()) messages.push('Crate license is required.');
  return messages;
}

/**
 * @param {{name:string, description:string, encodingFormat:string, contentSize:number}} fileMeta
 * @param {string} relativePath used to identify the file in the message
 * @returns {string[]} human-readable messages for any missing required fields; empty when valid.
 */
export function validateFileMetadata(fileMeta, relativePath) {
  const messages = [];
  if (!fileMeta.name?.trim()) messages.push(`"${relativePath}" is missing a name.`);
  if (!fileMeta.description?.trim()) messages.push(`"${relativePath}" is missing a description.`);
  if (!fileMeta.encodingFormat?.trim()) messages.push(`"${relativePath}" is missing an encoding format.`);
  if (!fileMeta.contentSize || fileMeta.contentSize <= 0) messages.push(`"${relativePath}" is missing a content size.`);
  return messages;
}

/**
 * @param {{name:string, description:string, datePublished:string, license:string}} crateMeta
 * @param {{metadata:object, readError:string|null}[]} files
 * @returns {boolean} whether the crate can be generated right now.
 */
export function isCrateReady(crateMeta, files) {
  if (validateCrateMetadata(crateMeta).length > 0) return false;
  if (files.length === 0) return false;
  return files.every((f) => validateFileMetadata(f.metadata, f.relativePath).length === 0);
}

/**
 * Builds an RO-Crate 1.3 JSON-LD document from crate-level metadata and a
 * list of files (each with their extracted/edited metadata).
 * @param {{name:string, description:string, datePublished:string, license:string}} crateMeta
 * @param {{relativePath:string, metadata:object}[]} files
 * @returns {object} the ro-crate-metadata.json content (as a JS object).
 */
export function buildCrate(crateMeta, files) {
  const seed = {
    '@context': [RO_CRATE_CONTEXT_URI, { '@vocab': 'http://schema.org/' }],
    '@graph': [
      { '@id': './', '@type': 'Dataset' },
      {
        '@id': 'ro-crate-metadata.json',
        '@type': 'CreativeWork',
        identifier: 'ro-crate-metadata.json',
        about: { '@id': './' },
        conformsTo: { '@id': RO_CRATE_SPEC_URI },
      },
    ],
  };

  const crate = new ROCrate(seed, { array: false, link: false });

  crate.rootDataset.name = crateMeta.name.trim();
  crate.rootDataset.description = crateMeta.description.trim();
  crate.rootDataset.datePublished = crateMeta.datePublished.trim();
  crate.rootDataset.license = licenseValue(crateMeta.license.trim());

  for (const file of files) {
    crate.addEntity(buildFileEntity(file));
    crate.addValues(crate.rootId, 'hasPart', { '@id': file.relativePath });
  }

  return crate.toJSON();
}

/** Builds the JSON-LD entity for a single File, from its (possibly edited) metadata. */
function buildFileEntity(file) {
  const m = file.metadata;
  const entity = {
    '@id': file.relativePath,
    '@type': 'File',
    name: m.name.trim(),
    description: m.description.trim(),
    encodingFormat: m.encodingFormat.trim(),
    contentSize: String(m.contentSize),
  };
  if (m.author?.trim()) entity.author = m.author.trim();
  if (m.keywords?.trim()) entity.keywords = m.keywords.trim();
  if (m.creationDate?.trim()) entity.dateCreated = m.creationDate.trim();
  return entity;
}

/** A license that looks like a URL is linked as its own entity; otherwise stored as plain text. */
function licenseValue(license) {
  try {
    const url = new URL(license);
    return { '@id': url.toString() };
  } catch {
    return license;
  }
}
