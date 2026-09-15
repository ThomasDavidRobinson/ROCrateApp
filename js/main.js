// Application orchestration: wires the DOM to the file-system, PDF and
// RO-Crate modules, and owns the in-memory state for the current folder.
import {
  isFileSystemAccessSupported,
  pickInputDirectory,
  pickOutputDirectory,
  scanDirectory,
  writeFileToDirectory,
} from './fileSystem.js';
import { extractPdfMetadata, applyMetadataAndGetBytes } from './pdfHandler.js';
import {
  validateCrateMetadata,
  validateFileMetadata,
  isCrateReady,
  buildCrate,
} from './rocrateBuilder.js';
import { createFieldRow, createReadOnlyItem, formatBytes, setHidden, buildTreeElement, countTreeFiles } from './ui.js';

const els = {
  unsupportedNotice: document.getElementById('unsupported-notice'),
  selectFolderBtn: document.getElementById('select-folder-btn'),
  selectSummary: document.getElementById('select-summary'),
  confirmSection: document.getElementById('confirm-section'),
  confirmSummary: document.getElementById('confirm-summary'),
  confirmTree: document.getElementById('confirm-tree'),
  confirmUseBtn: document.getElementById('confirm-use-btn'),
  confirmAgainBtn: document.getElementById('confirm-again-btn'),
  crateSection: document.getElementById('crate-section'),
  crateForm: document.getElementById('crate-form'),
  filesSection: document.getElementById('files-section'),
  filesCount: document.getElementById('files-count'),
  filesEmptyNotice: document.getElementById('files-empty-notice'),
  filesList: document.getElementById('files-list'),
  actionsSection: document.getElementById('actions-section'),
  validationSummary: document.getElementById('validation-summary'),
  generateBtn: document.getElementById('generate-btn'),
  saveBtn: document.getElementById('save-btn'),
  previewDetails: document.getElementById('preview-details'),
  previewJson: document.getElementById('preview-json'),
  statusRegion: document.getElementById('status-region'),
  errorRegion: document.getElementById('error-region'),
};

/** @typedef {{name:string, description:string, author:string, keywords:string,
 *   creationDate:string, encodingFormat:string, contentSize:number}} FileMetadata */

const state = {
  rootName: '',
  crateMeta: { name: '', description: '', datePublished: todayIso(), license: '' },
  crateOriginalDefaults: { name: '', description: '', datePublished: todayIso(), license: '' },
  /** @type {{relativePath:string, file:File, arrayBuffer:ArrayBuffer, readError:string|null,
   *   metadata:FileMetadata, originalDefaults:FileMetadata,
   *   pdfInfo:{creator:string, producer:string, modificationDate:string, pageCount:number}|null,
   *   statusChip:HTMLElement|null}[]} */
  files: [],
  generatedCrateJson: null,
  /** Folder awaiting user confirmation before its PDFs are loaded. */
  pendingFolder: null,
};

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function baseName(relativePath) {
  const last = relativePath.split('/').pop();
  return last.replace(/\.pdf$/i, '');
}

function setStatus(message) {
  els.statusRegion.textContent = message;
}

function showError(message) {
  els.errorRegion.textContent = message;
}

function clearError() {
  els.errorRegion.textContent = '';
}

function init() {
  if (!isFileSystemAccessSupported()) {
    setHidden(els.unsupportedNotice, false);
    els.selectFolderBtn.disabled = true;
    return;
  }
  els.selectFolderBtn.addEventListener('click', handleSelectFolder);
  els.confirmUseBtn.addEventListener('click', handleConfirmFolder);
  els.confirmAgainBtn.addEventListener('click', handleSelectFolder);
  els.generateBtn.addEventListener('click', handleGenerate);
  els.saveBtn.addEventListener('click', handleSave);
}

/** Opens the native folder picker, then shows an in-app preview of its contents for confirmation. */
async function handleSelectFolder() {
  clearError();
  let dirHandle;
  try {
    dirHandle = await pickInputDirectory();
  } catch (err) {
    showError(`Could not open the folder picker: ${err.message}`);
    return;
  }
  if (!dirHandle) return;

  els.selectFolderBtn.disabled = true;
  els.confirmAgainBtn.disabled = true;
  setStatus('Reading folder…');
  setHidden(els.confirmSection, true);

  try {
    const { tree, pdfFiles } = await scanDirectory(dirHandle);
    state.pendingFolder = { dirHandle, pdfFiles };

    const { pdfCount, otherCount } = countTreeFiles(tree);
    els.confirmSummary.textContent =
      pdfCount === 0
        ? `No PDF files were found in "${dirHandle.name}" (including its subfolders). You can still browse its contents below, or choose a different folder.`
        : `Found ${pdfCount} PDF file${pdfCount === 1 ? '' : 's'} in "${dirHandle.name}"` +
          (otherCount > 0 ? ` (${otherCount} other file${otherCount === 1 ? '' : 's'} will be skipped).` : '.');
    els.confirmTree.replaceChildren(buildTreeElement(tree));
    els.confirmUseBtn.disabled = pdfCount === 0;

    setHidden(els.confirmSection, false);
    els.confirmSection.scrollIntoView({ block: 'nearest' });
    setStatus(`Showing contents of "${dirHandle.name}" for confirmation.`);
  } catch (err) {
    showError(`Something went wrong while reading the folder: ${err.message}`);
  } finally {
    els.selectFolderBtn.disabled = false;
    els.confirmAgainBtn.disabled = false;
  }
}

/** Loads and extracts metadata for the PDFs in the confirmed folder. */
async function handleConfirmFolder() {
  if (!state.pendingFolder) return;
  const { dirHandle, pdfFiles } = state.pendingFolder;

  clearError();
  els.confirmUseBtn.disabled = true;
  setStatus('Reading PDF metadata…');

  try {
    state.rootName = dirHandle.name;
    state.files = await Promise.all(pdfFiles.map(({ relativePath, file }) => loadFileState(relativePath, file)));

    state.crateMeta = { name: dirHandle.name, description: '', datePublished: todayIso(), license: '' };
    state.crateOriginalDefaults = { ...state.crateMeta };
    state.generatedCrateJson = null;
    state.pendingFolder = null;

    renderCrateForm();
    renderFilesList();
    revalidate();

    setHidden(els.confirmSection, true);
    setHidden(els.crateSection, false);
    setHidden(els.filesSection, false);
    setHidden(els.actionsSection, false);
    setHidden(els.previewDetails, true);

    setStatus(`Loaded ${state.files.length} PDF file${state.files.length === 1 ? '' : 's'} from "${dirHandle.name}".`);
    els.crateSection.scrollIntoView({ block: 'nearest' });
  } catch (err) {
    showError(`Something went wrong while reading the PDFs: ${err.message}`);
  } finally {
    els.confirmUseBtn.disabled = false;
  }
}

/** Reads one PDF's bytes and extracted metadata into a file state entry. */
async function loadFileState(relativePath, file) {
  const entry = {
    relativePath,
    file,
    arrayBuffer: null,
    readError: null,
    metadata: null,
    originalDefaults: null,
    pdfInfo: null,
    statusChip: null,
  };

  try {
    entry.arrayBuffer = await file.arrayBuffer();
    const pdfMeta = await extractPdfMetadata(entry.arrayBuffer);
    entry.metadata = {
      name: pdfMeta.title || baseName(relativePath),
      description: pdfMeta.subject || '',
      author: pdfMeta.author || '',
      keywords: pdfMeta.keywords || '',
      creationDate: pdfMeta.creationDate || '',
      encodingFormat: 'application/pdf',
      contentSize: file.size,
    };
    entry.pdfInfo = {
      creator: pdfMeta.creator,
      producer: pdfMeta.producer,
      modificationDate: pdfMeta.modificationDate,
      pageCount: pdfMeta.pageCount,
    };
  } catch (err) {
    entry.readError = err.message;
    entry.metadata = {
      name: baseName(relativePath),
      description: '',
      author: '',
      keywords: '',
      creationDate: '',
      encodingFormat: 'application/pdf',
      contentSize: file.size,
    };
  }

  entry.originalDefaults = { ...entry.metadata };
  return entry;
}

function renderCrateForm() {
  els.crateForm.replaceChildren();

  const fields = [
    { key: 'name', label: 'Name', type: 'text', required: true },
    { key: 'description', label: 'Description', type: 'textarea', required: true },
    { key: 'datePublished', label: 'Date published', type: 'date', required: true },
    {
      key: 'license',
      label: 'License',
      type: 'text',
      required: true,
      hint: 'A license URL (e.g. a Creative Commons link) or a plain-text license statement.',
    },
  ];

  for (const field of fields) {
    const { wrapper } = createFieldRow({
      id: `crate-${field.key}`,
      label: field.label,
      type: field.type,
      value: state.crateMeta[field.key],
      originalValue: state.crateOriginalDefaults[field.key],
      required: field.required,
      hint: field.hint,
      onChange: (value) => {
        state.crateMeta[field.key] = value;
        revalidate();
      },
    });
    els.crateForm.appendChild(wrapper);
  }
}

function renderFilesList() {
  els.filesList.replaceChildren();
  els.filesCount.textContent = String(state.files.length);
  setHidden(els.filesEmptyNotice, state.files.length !== 0);

  for (const entry of state.files) {
    els.filesList.appendChild(renderFileCard(entry));
  }
}

function renderFileCard(entry) {
  const li = document.createElement('li');
  li.className = 'file-card';

  const details = document.createElement('details');
  const summary = document.createElement('summary');
  summary.textContent = entry.relativePath;

  const metaLine = document.createElement('div');
  metaLine.className = 'file-meta-line';
  metaLine.textContent = formatBytes(entry.file.size) + (entry.pdfInfo ? ` · ${entry.pdfInfo.pageCount} page${entry.pdfInfo.pageCount === 1 ? '' : 's'}` : '');

  const statusChip = document.createElement('span');
  statusChip.className = 'field-badge';
  entry.statusChip = statusChip;
  metaLine.append(' · ', statusChip);

  summary.appendChild(metaLine);
  details.appendChild(summary);

  if (entry.readError) {
    const notice = document.createElement('p');
    notice.className = 'notice notice-warning';
    notice.textContent = `${entry.readError} You can still describe this file manually below.`;
    details.appendChild(notice);
  }

  const fieldsWrapper = document.createElement('div');
  fieldsWrapper.className = 'file-fields';

  const editableFields = [
    { key: 'name', label: 'Name', type: 'text', required: true },
    { key: 'description', label: 'Description', type: 'textarea', required: true },
    { key: 'author', label: 'Author', type: 'text', required: false },
    { key: 'keywords', label: 'Keywords', type: 'text', required: false, hint: 'Separate multiple keywords with commas.' },
    { key: 'creationDate', label: 'Date created', type: 'date', required: false },
  ];

  const idPrefix = `file-${slugify(entry.relativePath)}`;
  for (const field of editableFields) {
    const { wrapper } = createFieldRow({
      id: `${idPrefix}-${field.key}`,
      label: field.label,
      type: field.type,
      value: entry.metadata[field.key],
      originalValue: entry.originalDefaults[field.key],
      required: field.required,
      hint: field.hint,
      onChange: (value) => {
        entry.metadata[field.key] = value;
        updateFileStatusChip(entry);
        revalidate();
      },
    });
    fieldsWrapper.appendChild(wrapper);
  }

  const readOnlyRow = document.createElement('div');
  readOnlyRow.className = 'read-only-fields';
  readOnlyRow.append(
    createReadOnlyItem('Encoding format', entry.metadata.encodingFormat),
    createReadOnlyItem('Content size', `${entry.metadata.contentSize} bytes`),
  );
  if (entry.pdfInfo?.producer) readOnlyRow.append(createReadOnlyItem('PDF producer', entry.pdfInfo.producer));
  if (entry.pdfInfo?.modificationDate) readOnlyRow.append(createReadOnlyItem('Last modified (PDF)', entry.pdfInfo.modificationDate));
  fieldsWrapper.appendChild(readOnlyRow);

  details.appendChild(fieldsWrapper);
  li.appendChild(details);

  updateFileStatusChip(entry);
  return li;
}

function slugify(relativePath) {
  return relativePath.replace(/[^a-zA-Z0-9]+/g, '-');
}

function updateFileStatusChip(entry) {
  if (!entry.statusChip) return;
  const missing = validateFileMetadata(entry.metadata, entry.relativePath);
  if (missing.length > 0) {
    entry.statusChip.dataset.state = 'required';
    entry.statusChip.textContent = `${missing.length} field${missing.length === 1 ? '' : 's'} needed`;
  } else {
    entry.statusChip.dataset.state = 'default';
    entry.statusChip.textContent = 'Complete';
  }
}

function collectValidationMessages() {
  const messages = [...validateCrateMetadata(state.crateMeta)];
  if (state.files.length === 0) {
    messages.push('Select a folder that contains at least one PDF file.');
  }
  for (const entry of state.files) {
    messages.push(...validateFileMetadata(entry.metadata, entry.relativePath));
  }
  return messages;
}

function revalidate() {
  const messages = collectValidationMessages();
  const ready = isCrateReady(state.crateMeta, state.files);

  els.generateBtn.disabled = !ready;
  els.validationSummary.textContent =
    messages.length === 0
      ? 'All required metadata is complete. Ready to generate the RO-Crate.'
      : `Before generating, please complete: ${messages.join(' ')}`;
}

function handleGenerate() {
  clearError();
  if (!isCrateReady(state.crateMeta, state.files)) {
    revalidate();
    return;
  }

  try {
    const crateJson = buildCrate(
      state.crateMeta,
      state.files.map((entry) => ({ relativePath: entry.relativePath, metadata: entry.metadata })),
    );
    state.generatedCrateJson = crateJson;
    els.previewJson.textContent = JSON.stringify(crateJson, null, 2);
    setHidden(els.previewDetails, false);
    els.saveBtn.disabled = false;
    setStatus('RO-Crate generated. You can now save it to a folder on your device.');
  } catch (err) {
    showError(`Could not generate the RO-Crate: ${err.message}`);
  }
}

async function handleSave() {
  clearError();
  if (!state.generatedCrateJson) return;

  // Re-validate and rebuild from the current state in case fields were
  // edited after "Generate" was clicked, so the saved crate and PDFs
  // always reflect the latest edits rather than a stale preview.
  if (!isCrateReady(state.crateMeta, state.files)) {
    revalidate();
    showError('Some required fields were changed and are now empty. Please complete them and generate the RO-Crate again before saving.');
    return;
  }
  state.generatedCrateJson = buildCrate(
    state.crateMeta,
    state.files.map((entry) => ({ relativePath: entry.relativePath, metadata: entry.metadata })),
  );
  els.previewJson.textContent = JSON.stringify(state.generatedCrateJson, null, 2);

  let outputHandle;
  try {
    outputHandle = await pickOutputDirectory();
  } catch (err) {
    showError(`Could not open the save folder picker: ${err.message}`);
    return;
  }
  if (!outputHandle) return;

  els.saveBtn.disabled = true;
  setStatus('Saving crate…');

  const warnings = [];
  const failures = [];

  for (const entry of state.files) {
    try {
      const { bytes, warning } = await applyMetadataAndGetBytes(entry.arrayBuffer, entry.metadata);
      await writeFileToDirectory(outputHandle, entry.relativePath, bytes);
      if (warning) warnings.push(`"${entry.relativePath}": ${warning}`);
    } catch (err) {
      failures.push(`"${entry.relativePath}": ${err.message}`);
    }
  }

  try {
    await writeFileToDirectory(outputHandle, 'ro-crate-metadata.json', JSON.stringify(state.generatedCrateJson, null, 2));
  } catch (err) {
    failures.push(`ro-crate-metadata.json: ${err.message}`);
  }

  els.saveBtn.disabled = false;

  if (failures.length > 0) {
    showError(`The crate was saved to "${outputHandle.name}", but some files could not be written: ${failures.join(' ')}`);
  } else if (warnings.length > 0) {
    setStatus(`Crate saved to "${outputHandle.name}" with ${warnings.length} warning(s): ${warnings.join(' ')}`);
  } else {
    setStatus(`Crate saved successfully to "${outputHandle.name}".`);
  }
}

init();
