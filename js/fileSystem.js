// File System Access API helpers: reading a source folder tree and
// writing the generated crate (PDF copies + ro-crate-metadata.json) to
// a destination folder. Nothing here touches PDF or RO-Crate content.

/**
 * @returns {boolean} whether the browser supports the File System Access API.
 */
export function isFileSystemAccessSupported() {
  return typeof window.showDirectoryPicker === 'function';
}

/**
 * Prompts the user to choose a folder to read from.
 * @returns {Promise<FileSystemDirectoryHandle|null>} the chosen handle, or
 *   null if the user cancelled the picker.
 */
export async function pickInputDirectory() {
  try {
    return await window.showDirectoryPicker({ mode: 'read' });
  } catch (err) {
    if (err && err.name === 'AbortError') return null;
    throw err;
  }
}

/**
 * Prompts the user to choose a folder to write the crate into.
 * @returns {Promise<FileSystemDirectoryHandle|null>} the chosen handle, or
 *   null if the user cancelled the picker.
 */
export async function pickOutputDirectory() {
  try {
    return await window.showDirectoryPicker({ mode: 'readwrite' });
  } catch (err) {
    if (err && err.name === 'AbortError') return null;
    throw err;
  }
}

const PDF_EXTENSION = /\.pdf$/i;

/**
 * @typedef {{name:string, kind:'file', relativePath:string, isPdf:boolean, size:number}} FileTreeNode
 * @typedef {{name:string, kind:'directory', relativePath:string, children:(FileTreeNode|DirectoryTreeNode)[]}} DirectoryTreeNode
 */

/**
 * Recursively walks a directory handle once, producing both a full tree of
 * its contents (so the user can visually confirm they picked the right
 * folder before anything is read) and a flat, sorted list of the PDF files
 * within it (including subfolders), each with a path relative to the
 * chosen root using '/' separators, suitable for use as an RO-Crate @id.
 * @param {FileSystemDirectoryHandle} rootHandle
 * @returns {Promise<{tree: (FileTreeNode|DirectoryTreeNode)[], pdfFiles: {relativePath:string, file:File}[]}>}
 */
export async function scanDirectory(rootHandle) {
  const pdfFiles = [];

  async function walk(dirHandle, prefix) {
    const entries = [];
    for await (const entry of dirHandle.entries()) entries.push(entry);
    entries.sort((a, b) => a[0].localeCompare(b[0]));

    const nodes = [];
    for (const [name, handle] of entries) {
      const relativePath = prefix ? `${prefix}/${name}` : name;
      if (handle.kind === 'directory') {
        nodes.push({ name, kind: 'directory', relativePath, children: await walk(handle, relativePath) });
      } else {
        const isPdf = PDF_EXTENSION.test(name);
        const file = await handle.getFile();
        nodes.push({ name, kind: 'file', relativePath, isPdf, size: file.size });
        if (isPdf) pdfFiles.push({ relativePath, file });
      }
    }
    return nodes;
  }

  const tree = await walk(rootHandle, '');
  return { tree, pdfFiles };
}

/**
 * Writes bytes to a file at a (possibly nested) relative path under a
 * directory handle, creating intermediate subdirectories as needed.
 * @param {FileSystemDirectoryHandle} rootHandle
 * @param {string} relativePath e.g. "subfolder/document.pdf"
 * @param {Uint8Array|string} contents
 */
export async function writeFileToDirectory(rootHandle, relativePath, contents) {
  const segments = relativePath.split('/').filter(Boolean);
  const fileName = segments.pop();

  let dirHandle = rootHandle;
  for (const segment of segments) {
    dirHandle = await dirHandle.getDirectoryHandle(segment, { create: true });
  }

  const fileHandle = await dirHandle.getFileHandle(fileName, { create: true });
  const writable = await fileHandle.createWritable();
  try {
    await writable.write(contents);
  } finally {
    await writable.close();
  }
}
