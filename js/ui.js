// Pure DOM-building/rendering helpers. This file knows nothing about PDFs
// or RO-Crate — it only turns plain data into elements and reports user
// input back through callbacks.

/**
 * Creates a labelled, editable field row with a badge showing whether the
 * current value is unedited (matches the original default), edited, or
 * (if required) still empty.
 * @param {{id:string, label:string, type?:'text'|'textarea'|'date', value:string,
 *   originalValue:string, required?:boolean, hint?:string, onChange:(value:string)=>void}} config
 * @returns {{wrapper:HTMLElement, input:HTMLElement, updateBadge:()=>void}}
 */
export function createFieldRow(config) {
  const { id, label, type = 'text', value, originalValue, required = false, hint, onChange } = config;

  const wrapper = document.createElement('div');
  wrapper.className = 'field';

  const labelRow = document.createElement('div');
  labelRow.className = 'field-label-row';

  const labelEl = document.createElement('label');
  labelEl.setAttribute('for', id);
  labelEl.textContent = label;
  if (required) {
    const marker = document.createElement('span');
    marker.className = 'required-marker';
    marker.setAttribute('aria-hidden', 'true');
    marker.textContent = ' *';
    labelEl.appendChild(marker);
  }

  const badge = document.createElement('span');
  badge.className = 'field-badge';

  labelRow.append(labelEl, badge);

  const input = type === 'textarea' ? document.createElement('textarea') : document.createElement('input');
  input.id = id;
  input.name = id;
  if (type !== 'textarea') input.type = type;
  input.value = value;
  if (required) input.setAttribute('aria-required', 'true');

  function updateBadge() {
    const current = input.value;
    if (!current.trim()) {
      if (required) {
        badge.dataset.state = 'required';
        badge.textContent = 'Required';
      } else {
        delete badge.dataset.state;
        badge.textContent = '';
      }
      return;
    }
    if (current === originalValue) {
      badge.dataset.state = 'default';
      badge.textContent = 'Unedited';
    } else {
      badge.dataset.state = 'edited';
      badge.textContent = 'Edited';
    }
  }

  input.addEventListener('input', () => {
    updateBadge();
    onChange(input.value);
  });

  updateBadge();

  wrapper.append(labelRow, input);
  if (hint) {
    const hintEl = document.createElement('p');
    hintEl.className = 'hint';
    hintEl.textContent = hint;
    wrapper.appendChild(hintEl);
  }

  return { wrapper, input, updateBadge };
}

/**
 * A small non-editable label/value pair, for metadata that isn't user-editable
 * (e.g. page count, PDF producer).
 */
export function createReadOnlyItem(label, value) {
  const item = document.createElement('span');
  const strong = document.createElement('strong');
  strong.textContent = `${label}: `;
  item.append(strong, document.createTextNode(value));
  return item;
}

/** Formats a byte count as a short human-readable string. */
export function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return '';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(1)} ${units[unitIndex]}`;
}

/** Replaces the contents of an element with a plain text message. */
export function setText(element, text) {
  element.textContent = text;
}

/** Shows or hides an element via the `hidden` attribute. */
export function setHidden(element, hidden) {
  element.hidden = hidden;
}

/**
 * Builds a nested <ul> representing a folder's contents (from
 * fileSystem.scanDirectory's tree), so a user can visually confirm they
 * picked the right folder. PDFs are highlighted; everything else is
 * marked as something the app will skip.
 * @param {(object)[]} nodes
 * @returns {HTMLUListElement}
 */
export function buildTreeElement(nodes) {
  const ul = document.createElement('ul');
  ul.setAttribute('role', 'group');

  for (const node of nodes) {
    const li = document.createElement('li');
    li.setAttribute('role', 'treeitem');

    if (node.kind === 'directory') {
      li.textContent = `📁 ${node.name}`;
      li.appendChild(buildTreeElement(node.children));
    } else {
      const span = document.createElement('span');
      span.className = `node-file ${node.isPdf ? 'is-pdf' : 'is-skipped'}`;
      span.textContent = node.isPdf
        ? `📄 ${node.name}`
        : `${node.name} — not a PDF, will be skipped`;
      const sizeSpan = document.createElement('span');
      sizeSpan.className = 'node-size';
      sizeSpan.textContent = ` (${formatBytes(node.size)})`;
      span.appendChild(sizeSpan);
      li.appendChild(span);
    }

    ul.appendChild(li);
  }

  return ul;
}

/** Counts PDF and non-PDF files anywhere in a scanDirectory tree. */
export function countTreeFiles(nodes) {
  let pdfCount = 0;
  let otherCount = 0;
  for (const node of nodes) {
    if (node.kind === 'directory') {
      const counts = countTreeFiles(node.children);
      pdfCount += counts.pdfCount;
      otherCount += counts.otherCount;
    } else if (node.isPdf) {
      pdfCount += 1;
    } else {
      otherCount += 1;
    }
  }
  return { pdfCount, otherCount };
}
