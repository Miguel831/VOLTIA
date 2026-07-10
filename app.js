const SUGERENCIAS_ELEMENTOS = [
  'Cuadro general de baja tensión',
  'Cuadro secundario',
  'Interruptor general automático',
  'Interruptor diferencial',
  'Magnetotérmico',
  'Protección contra sobretensiones',
  'Toma de tierra',
  'Conductor de protección',
  'Línea de alimentación',
  'Toma de corriente',
  'Punto de luz',
  'Luminaria de emergencia',
  'Alumbrado exterior',
  'Canalización eléctrica',
  'Caja de derivación',
  'Borna de conexión',
  'Motor eléctrico',
  'Bomba de impulsión',
  'Sensor de nivel',
  'Sonda de temperatura',
  'Presostato',
  'Válvula motorizada',
  'Sistema de ventilación',
  'Equipo de climatización',
  'Sistema de puesta a tierra',
  'Pararrayos',
  'Rack de comunicaciones',
  'Punto de red',
  'Sistema de control',
  'Autómata programable PLC',
  'Fuente de alimentación',
  'Transformador',
  'Batería SAI',
  'Grupo electrógeno',
  'Sistema contra incendios'
];

const STORAGE_KEY = 'informeTecnicoDraft.v2';

const state = {
  general: {
    cliente: '',
    emplazamiento: '',
    instalacion: '',
    numeroInforme: ''
  },
  elements: [],
  currentInkDataUrl: '',
  currentInkText: '',
  currentInputMethod: 'manual',
  reportHtml: '',
  speech: {
    activeRecognition: null,
    activeButton: null,
    permissionState: 'unknown'
  },
  handwriting: {
    supported: false,
    ready: false,
    recognizer: null,
    drawing: null,
    activeStroke: null,
    activeStrokeStart: 0,
    lastPointerType: 'stylus',
    lastPredictions: [],
    hasInk: false,
    ocrScriptPromise: null,
    ocrBusy: false
  }
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => document.querySelectorAll(selector);

const dom = {
  saveStatus: $('#saveStatus'),
  generalForm: $('#generalForm'),
  cliente: $('#cliente'),
  emplazamiento: $('#emplazamiento'),
  instalacion: $('#instalacion'),
  numeroInforme: $('#numeroInforme'),
  elementForm: $('#elementForm'),
  editingIndex: $('#editingIndex'),
  elemento: $('#elemento'),
  valor: $('#valor'),
  observaciones: $('#observaciones'),
  datalist: $('#elementosSugeridos'),
  voiceElemento: $('#voiceElemento'),
  voiceObservaciones: $('#voiceObservaciones'),
  inkElemento: $('#inkElemento'),
  elementoInkPreview: $('#elementoInkPreview'),
  addElementButton: $('#addElementButton'),
  clearElementForm: $('#clearElementForm'),
  tableBody: $('#elementsTableBody'),
  elementCounter: $('#elementCounter'),
  generateReport: $('#generateReport'),
  downloadHtml: $('#downloadHtml'),
  downloadDoc: $('#downloadDoc'),
  printReport: $('#printReport'),
  resetApp: $('#resetApp'),
  validationSummary: $('#validationSummary'),
  reportPreview: $('#reportPreview'),
  inkDialog: $('#inkDialog'),
  inkCanvas: $('#inkCanvas'),
  clearInk: $('#clearInk'),
  recognizeInk: $('#recognizeInk'),
  saveInk: $('#saveInk'),
  inkTranscription: $('#inkTranscription'),
  inkStatus: $('#inkStatus'),
  inkCandidates: $('#inkCandidates')
};

function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function normalizeText(value = '') {
  return value
    .toString()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9ñ\s]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function levenshteinDistance(a, b) {
  const source = normalizeText(a);
  const target = normalizeText(b);
  if (source === target) return 0;
  if (!source) return target.length;
  if (!target) return source.length;

  const previous = Array.from({ length: target.length + 1 }, (_, index) => index);
  const current = new Array(target.length + 1);

  for (let i = 1; i <= source.length; i += 1) {
    current[0] = i;
    for (let j = 1; j <= target.length; j += 1) {
      const cost = source[i - 1] === target[j - 1] ? 0 : 1;
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + cost
      );
    }
    previous.splice(0, previous.length, ...current);
  }

  return previous[target.length];
}

function similarityScore(query, candidate) {
  const q = normalizeText(query);
  const c = normalizeText(candidate);
  if (!q) return 0;
  if (c === q) return 100;
  if (c.startsWith(q)) return 92 - Math.min(18, c.length - q.length);
  if (c.includes(q)) return 74 - Math.min(18, c.indexOf(q));

  const qWords = q.split(/\s+/).filter(Boolean);
  const cWords = c.split(/\s+/).filter(Boolean);
  const wordHits = qWords.filter(word => cWords.some(cw => cw.startsWith(word) || cw.includes(word) || levenshteinDistance(word, cw) <= 2)).length;
  const wordScore = wordHits ? 45 + wordHits * 10 : 0;

  const distance = levenshteinDistance(q, c);
  const maxLen = Math.max(q.length, c.length) || 1;
  const editScore = Math.max(0, 70 - Math.round((distance / maxLen) * 70));

  return Math.max(wordScore, editScore);
}

function getBestSuggestions(query, limit = 8) {
  const scored = SUGERENCIAS_ELEMENTOS
    .map(item => ({ text: item, score: similarityScore(query, item), source: 'Lista de elementos' }))
    .filter(result => !query || result.score > 18)
    .sort((a, b) => b.score - a.score || a.text.localeCompare(b.text))
    .slice(0, limit);

  if (query && !scored.some(result => normalizeText(result.text) === normalizeText(query))) {
    scored.unshift({ text: query.trim(), score: 100, source: 'Lectura directa' });
  }

  return scored.slice(0, limit);
}

function mergeCandidates(...groups) {
  const map = new Map();
  groups.flat().forEach(candidate => {
    const text = (candidate.text || '').trim();
    if (!text) return;
    const key = normalizeText(text);
    const score = Number(candidate.score ?? candidate.confidence ?? 0);
    const existing = map.get(key);
    if (!existing || score > existing.score) {
      map.set(key, { text, score, source: candidate.source || 'Detectado' });
    }
  });
  return [...map.values()].sort((a, b) => b.score - a.score).slice(0, 8);
}

function updateDatalist() {
  const query = dom.elemento.value;
  const sorted = getBestSuggestions(query, 10).map(result => result.text);
  dom.datalist.innerHTML = sorted.map(item => `<option value="${escapeHtml(item)}"></option>`).join('');
}

function readGeneralForm() {
  state.general = {
    cliente: dom.cliente.value.trim(),
    emplazamiento: dom.emplazamiento.value.trim(),
    instalacion: dom.instalacion.value.trim(),
    numeroInforme: dom.numeroInforme.value.trim()
  };
}

function setSaveStatus(text, type = 'ok') {
  dom.saveStatus.textContent = text;
  if (type === 'error') {
    dom.saveStatus.style.background = '#fff0ee';
    dom.saveStatus.style.color = '#b42318';
    dom.saveStatus.style.borderColor = '#fecdca';
  } else if (type === 'warning') {
    dom.saveStatus.style.background = '#fff7ed';
    dom.saveStatus.style.color = '#9a3412';
    dom.saveStatus.style.borderColor = '#fed7aa';
  } else {
    dom.saveStatus.style.background = '#ecfdf3';
    dom.saveStatus.style.color = '#067647';
    dom.saveStatus.style.borderColor = '#abefc6';
  }
}

function saveDraft() {
  readGeneralForm();
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ general: state.general, elements: state.elements }));
  setSaveStatus('Borrador guardado');
}

function loadDraft() {
  const raw = localStorage.getItem(STORAGE_KEY) || localStorage.getItem('informeTecnicoDraft.v1');
  if (!raw) return;

  try {
    const data = JSON.parse(raw);
    state.general = data.general || state.general;
    state.elements = Array.isArray(data.elements) ? data.elements : [];

    dom.cliente.value = state.general.cliente || '';
    dom.emplazamiento.value = state.general.emplazamiento || '';
    dom.instalacion.value = state.general.instalacion || '';
    dom.numeroInforme.value = state.general.numeroInforme || '';

    renderElementsTable();
    setSaveStatus('Borrador recuperado');
  } catch {
    setSaveStatus('No se pudo recuperar el borrador', 'error');
  }
}

function debounce(callback, delay = 350) {
  let timeoutId;
  return (...args) => {
    window.clearTimeout(timeoutId);
    timeoutId = window.setTimeout(() => callback(...args), delay);
  };
}

function getContinuidadValue() {
  const checked = document.querySelector('input[name="continuidad"]:checked');
  return checked ? checked.value : '';
}

function setContinuidadValue(value) {
  $$('input[name="continuidad"]').forEach(input => { input.checked = input.value === value; });
}

function clearElementForm() {
  dom.elementForm.reset();
  dom.editingIndex.value = '';
  state.currentInkDataUrl = '';
  state.currentInkText = '';
  state.currentInputMethod = 'manual';
  dom.elementoInkPreview.innerHTML = '';
  dom.elementoInkPreview.classList.add('hidden');
  dom.addElementButton.textContent = 'Añadir elemento';
  updateDatalist();
}

function elementToRow(element, index) {
  const elementoText = escapeHtml(element.elemento || 'Sin texto reconocido');
  const inkThumb = element.inputMethod === 'ink' && element.inkDataUrl
    ? `<img class="ink-thumb" src="${element.inkDataUrl}" alt="Trazo manuscrito del elemento ${index + 1}" />`
    : '';
  const method = element.inputMethod === 'ink' ? '<span class="method-pill">✍️ leído de escritura</span>' : '';

  return `
    <tr>
      <td><strong>${elementoText}</strong>${method}${inkThumb}</td>
      <td>${escapeHtml(element.valor)}</td>
      <td>${escapeHtml(element.continuidad)}</td>
      <td>${escapeHtml(element.observaciones || '-')}</td>
      <td>
        <div class="row-actions">
          <button class="small-button" type="button" data-action="edit" data-index="${index}">Editar</button>
          <button class="small-button delete" type="button" data-action="delete" data-index="${index}">Eliminar</button>
        </div>
      </td>
    </tr>
  `;
}

function renderElementsTable() {
  if (!state.elements.length) {
    dom.tableBody.innerHTML = '<tr class="empty-row"><td colspan="5">Todavía no hay elementos añadidos.</td></tr>';
  } else {
    dom.tableBody.innerHTML = state.elements.map(elementToRow).join('');
  }

  dom.elementCounter.textContent = `${state.elements.length} ${state.elements.length === 1 ? 'elemento' : 'elementos'}`;
}

function addOrUpdateElement(event) {
  event.preventDefault();

  if (!dom.elementForm.reportValidity()) return;

  const element = {
    elemento: dom.elemento.value.trim(),
    valor: dom.valor.value.trim(),
    continuidad: getContinuidadValue(),
    observaciones: dom.observaciones.value.trim(),
    inkDataUrl: state.currentInkDataUrl || '',
    inputMethod: state.currentInputMethod || 'manual'
  };

  const index = dom.editingIndex.value;
  if (index !== '') {
    state.elements[Number(index)] = element;
  } else {
    state.elements.push(element);
  }

  renderElementsTable();
  clearElementForm();
  saveDraft();
}

function editElement(index) {
  const element = state.elements[index];
  if (!element) return;

  dom.editingIndex.value = index;
  dom.elemento.value = element.elemento || '';
  dom.valor.value = element.valor || '';
  setContinuidadValue(element.continuidad || '');
  dom.observaciones.value = element.observaciones || '';
  state.currentInkDataUrl = element.inkDataUrl || '';
  state.currentInkText = element.elemento || '';
  state.currentInputMethod = element.inputMethod || (element.inkDataUrl ? 'ink' : 'manual');
  dom.addElementButton.textContent = 'Guardar cambios';

  if (state.currentInputMethod === 'ink') {
    const previewImage = element.inkDataUrl ? `<img src="${element.inkDataUrl}" alt="Trazo manuscrito guardado" />` : '';
    dom.elementoInkPreview.innerHTML = `<strong>Texto leído de escritura:</strong> ${escapeHtml(element.elemento || '')}${previewImage}`;
    dom.elementoInkPreview.classList.remove('hidden');
  } else {
    dom.elementoInkPreview.innerHTML = '';
    dom.elementoInkPreview.classList.add('hidden');
  }

  dom.elemento.focus();
  updateDatalist();
}

function deleteElement(index) {
  const ok = window.confirm('¿Quieres eliminar este elemento revisado?');
  if (!ok) return;
  state.elements.splice(index, 1);
  renderElementsTable();
  clearElementForm();
  saveDraft();
}

function validateReport() {
  readGeneralForm();
  const errors = [];
  if (!state.general.cliente) errors.push('Cliente');
  if (!state.general.emplazamiento) errors.push('Emplazamiento');
  if (!state.general.instalacion) errors.push('Instalación');
  if (!state.general.numeroInforme) errors.push('Número de informe');
  if (!state.elements.length) errors.push('Al menos un elemento revisado');

  if (errors.length) {
    dom.validationSummary.innerHTML = `Falta completar: ${errors.map(escapeHtml).join(', ')}.`;
    dom.validationSummary.classList.remove('hidden');
    dom.validationSummary.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return false;
  }

  dom.validationSummary.classList.add('hidden');
  return true;
}

const VOLTIA_ROWS_PER_PAGE = 13;
const VOLTIA_TABLE_LAYOUT = {
  widthMm: 170,
  colFractions: [0.34, 0.21, 0.19, 0.26],
  headerHeightMm: 9,
  minRowHeightMm: 8,
  cellHorizontalPaddingMm: 4,
  cellVerticalPaddingMm: 2.4,
  rowLineHeightMm: 3.7,
  firstPageTableTopMm: 58,
  nextPageTableTopMm: 52,
  tableBottomMm: 277
};

const VOLTIA_TABLE_COL_WIDTHS_MM = VOLTIA_TABLE_LAYOUT.colFractions
  .map(fraction => VOLTIA_TABLE_LAYOUT.widthMm * fraction);

function estimateCharsPerLine(widthMm) {
  return Math.max(8, Math.floor(widthMm / 1.55));
}

function wrapTextForReportCell(text = '', widthMm = 40) {
  const maxChars = estimateCharsPerLine(Math.max(8, widthMm - VOLTIA_TABLE_LAYOUT.cellHorizontalPaddingMm));
  const words = String(text || '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  const lines = [];
  let line = '';

  words.forEach(word => {
    if (word.length > maxChars) {
      if (line) {
        lines.push(line);
        line = '';
      }
      for (let index = 0; index < word.length; index += maxChars) {
        lines.push(word.slice(index, index + maxChars));
      }
      return;
    }

    const candidate = line ? `${line} ${word}` : word;
    if (candidate.length <= maxChars || !line) {
      line = candidate;
    } else {
      lines.push(line);
      line = word;
    }
  });

  if (line) lines.push(line);
  return lines.length ? lines : [''];
}

function estimateVoltiaRowHeightMm(row) {
  if (!row) return VOLTIA_TABLE_LAYOUT.minRowHeightMm;

  const values = [
    row.elemento || '',
    row.valor || '',
    row.continuidad || '',
    row.observaciones || ''
  ];
  const lineCounts = values.map((value, index) => {
    return wrapTextForReportCell(value, VOLTIA_TABLE_COL_WIDTHS_MM[index]).length;
  });
  const maxLines = Math.max(1, ...lineCounts);
  const contentHeight = VOLTIA_TABLE_LAYOUT.cellVerticalPaddingMm + maxLines * VOLTIA_TABLE_LAYOUT.rowLineHeightMm;
  return Math.max(VOLTIA_TABLE_LAYOUT.minRowHeightMm, Math.ceil(contentHeight * 10) / 10);
}

function getVoltiaTableAvailableRowsHeightMm(showTitle) {
  const tableTop = showTitle ? VOLTIA_TABLE_LAYOUT.firstPageTableTopMm : VOLTIA_TABLE_LAYOUT.nextPageTableTopMm;
  return VOLTIA_TABLE_LAYOUT.tableBottomMm - tableTop - VOLTIA_TABLE_LAYOUT.headerHeightMm;
}

function makeVoltiaRow(element = null, overrides = {}) {
  const row = element ? {
    elemento: element.elemento || 'Sin texto reconocido',
    valor: element.valor || '-',
    continuidad: element.continuidad || '-',
    observaciones: element.observaciones || '-'
  } : {
    elemento: '',
    valor: '',
    continuidad: '',
    observaciones: ''
  };

  Object.assign(row, overrides);
  row.rowHeightMm = overrides.rowHeightMm || estimateVoltiaRowHeightMm(row);
  return row;
}

function splitVoltiaRowByObservation(row, maxHeightMm) {
  const maxLines = Math.max(1, Math.floor((maxHeightMm - VOLTIA_TABLE_LAYOUT.cellVerticalPaddingMm) / VOLTIA_TABLE_LAYOUT.rowLineHeightMm));
  const observationLines = wrapTextForReportCell(row.observaciones || '', VOLTIA_TABLE_COL_WIDTHS_MM[3]);

  if (observationLines.length <= maxLines) return [row];

  const chunks = [];
  for (let index = 0; index < observationLines.length; index += maxLines) {
    const observation = observationLines.slice(index, index + maxLines).join(' ');
    chunks.push(makeVoltiaRow(null, {
      elemento: index === 0 ? row.elemento : '',
      valor: index === 0 ? row.valor : '',
      continuidad: index === 0 ? row.continuidad : '',
      observaciones: observation,
      continuation: index > 0
    }));
  }

  return chunks;
}

function paginateVoltiaRows(elements) {
  const sourceRows = (elements.length ? elements : [null]).flatMap(element => {
    const row = makeVoltiaRow(element);
    const maxRowsHeight = Math.min(
      getVoltiaTableAvailableRowsHeightMm(true),
      getVoltiaTableAvailableRowsHeightMm(false)
    );
    return row.rowHeightMm > maxRowsHeight ? splitVoltiaRowByObservation(row, maxRowsHeight) : [row];
  });

  const pages = [];
  let currentRows = [];
  let currentHeight = 0;

  sourceRows.forEach(row => {
    const showTitle = pages.length === 0;
    const availableHeight = getVoltiaTableAvailableRowsHeightMm(showTitle);

    if (currentRows.length && currentHeight + row.rowHeightMm > availableHeight) {
      pages.push(currentRows);
      currentRows = [];
      currentHeight = 0;
    }

    currentRows.push(row);
    currentHeight += row.rowHeightMm;
  });

  if (currentRows.length) pages.push(currentRows);
  return pages.length ? pages : [[makeVoltiaRow(null)]];
}

function addEmptyVoltiaRows(rows, showTitle) {
  const output = [...rows];
  const availableHeight = getVoltiaTableAvailableRowsHeightMm(showTitle);
  let usedHeight = output.reduce((sum, row) => sum + row.rowHeightMm, 0);

  while (
    output.length < VOLTIA_ROWS_PER_PAGE &&
    usedHeight + VOLTIA_TABLE_LAYOUT.minRowHeightMm <= availableHeight
  ) {
    output.push(makeVoltiaRow(null));
    usedHeight += VOLTIA_TABLE_LAYOUT.minRowHeightMm;
  }

  return output;
}

function formatLongSpanishDate(date = new Date()) {
  return date.toLocaleDateString('es-ES', {
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  });
}

function formatShortSpanishDate(date = new Date()) {
  return date.toLocaleDateString('es-ES', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  });
}

function setTemplateField(doc, placeholder, value) {
  const safeValue = value || '-';
  doc.querySelectorAll('.campo-editable').forEach(node => {
    if (node.textContent.trim() === placeholder) {
      node.textContent = safeValue;
      node.style.fontStyle = 'normal';
      node.style.fontWeight = '700';
      node.style.color = 'var(--verde-texto)';
    }
  });
}

function findPageByHeading(doc, text) {
  const normalizedText = normalizeText(text);
  return [...doc.querySelectorAll('.page')].find(page => {
    return [...page.querySelectorAll('.titulo-seccion')]
      .some(heading => normalizeText(heading.textContent).includes(normalizedText));
  });
}

function setPageNumber(page, number) {
  const numberNode = page?.querySelector('.num-pagina');
  if (numberNode) numberNode.textContent = String(number);
}

function buildVoltiaElementRows(rows, showTitle) {
  return addEmptyVoltiaRows(rows, showTitle).map(row => {
    const height = Number(row.rowHeightMm || VOLTIA_TABLE_LAYOUT.minRowHeightMm);
    return `
      <tr data-row-height-mm="${height}" style="height:${height}mm;">
        <td>${escapeHtml(row.elemento || '')}</td>
        <td>${escapeHtml(row.valor || '')}</td>
        <td>${escapeHtml(row.continuidad || '')}</td>
        <td>${escapeHtml(row.observaciones || '')}</td>
      </tr>`;
  }).join('');
}

function buildVoltiaFooterHtml(pageNumber) {
  return `
      <div class="pie">
        <span class="revision">Rev.00</span>
        <span class="pagina-texto">Página <span class="num-pagina">${pageNumber}</span> de <span class="total-paginas"></span></span>
        <span class="web">voltia.es</span>
      </div>`;
}

function buildVoltiaElementsPage({ cabeceraHtml, pageNumber, rowsHtml, showTitle }) {
  return `
    <div class="page">
      ${cabeceraHtml}
      <div class="contenido">
        ${showTitle ? '<h1 class="titulo-seccion"><span class="num">1</span>ELEMENTOS REVISADOS</h1>' : ''}
        <table class="tabla-datos"${showTitle ? '' : ' style="margin-top:6mm;"'}>
          <colgroup><col class="c1"><col class="c2"><col class="c3"><col class="c4"></colgroup>
          <thead>
            <tr><th>LÍNEA</th><th>VALOR (Ω)</th><th>CONTINUIDAD</th><th>OBSERVACIONES</th></tr>
          </thead>
          <tbody>${rowsHtml}</tbody>
        </table>
      </div>
      ${buildVoltiaFooterHtml(pageNumber)}
    </div>`;
}

function updateVoltiaToc(doc, conclusionPageNumber, annexPageNumber) {
  const items = [...doc.querySelectorAll('.toc-item')];
  if (items[0]?.lastElementChild) items[0].lastElementChild.textContent = '3';
  if (items[1]?.lastElementChild) items[1].lastElementChild.textContent = String(conclusionPageNumber);
  if (items[2]?.lastElementChild) items[2].lastElementChild.textContent = String(annexPageNumber);
}

function updateVoltiaPageNumbers(doc) {
  const pages = [...doc.querySelectorAll('.page')];
  const totalPages = pages.length;
  pages.forEach((page, index) => {
    const pageNumber = page.querySelector('.num-pagina');
    if (pageNumber) pageNumber.textContent = String(index + 1);
    const totalNode = page.querySelector('.total-paginas');
    if (totalNode) totalNode.textContent = String(totalPages);
  });
}

function updateVoltiaConclusion(doc) {
  const conclusionPage = findPageByHeading(doc, 'CONCLUSIONES Y RECOMENDACIONES');
  const conclusionParagraph = conclusionPage?.querySelector('.contenido > p:not(.fecha-final)');
  if (!conclusionParagraph) return;

  const withoutContinuity = state.elements.filter(element => normalizeText(element.continuidad) === 'no');
  const withObservations = state.elements.filter(element => (element.observaciones || '').trim());

  if (withoutContinuity.length) {
    conclusionParagraph.textContent = `Efectuada la inspección de tierras en sus instalaciones eléctricas, se han registrado ${withoutContinuity.length} elemento(s) sin continuidad. Se recomienda revisar los puntos indicados en la tabla de elementos revisados y valorar las observaciones técnicas asociadas.`;
  } else if (withObservations.length) {
    conclusionParagraph.textContent = 'Efectuada la inspección de tierras en sus instalaciones eléctricas, no se han detectado puntos sin continuidad. Se dejan reflejadas las observaciones técnicas indicadas en la tabla para su seguimiento.';
  } else {
    conclusionParagraph.textContent = 'Efectuada la inspección de tierras en sus instalaciones eléctricas, no se han detectado puntos que necesiten revisión.';
  }
}

function fillVoltiaTemplate() {
  readGeneralForm();

  const templateHtml = window.VOLTIA_REPORT_TEMPLATE;
  if (!templateHtml) {
    throw new Error('No se ha cargado la plantilla VOLTIA.');
  }

  const parser = new DOMParser();
  const doc = parser.parseFromString(templateHtml, 'text/html');
  const longDate = formatLongSpanishDate();

  doc.title = `Informe Técnico ${state.general.numeroInforme || ''}`.trim();
  setTemplateField(doc, '[nombre del cliente]', state.general.cliente);
  setTemplateField(doc, '[dirección del emplazamiento]', state.general.emplazamiento);
  setTemplateField(doc, '[identificación de la instalación]', state.general.instalacion);
  setTemplateField(doc, '[nº de informe]', state.general.numeroInforme);
  setTemplateField(doc, '[día de mes de año]', longDate);
  setTemplateField(doc, '[fecha corta]', formatShortSpanishDate());
  setTemplateField(doc, '[Contenido del anexo]', 'Sin anexos adicionales.');

  const tablePages = [...new Set([...doc.querySelectorAll('table.tabla-datos')].map(table => table.closest('.page')).filter(Boolean))];
  const firstTablePage = tablePages[0];
  const cabeceraHtml = firstTablePage?.querySelector('.cabecera')?.outerHTML || doc.querySelector('.cabecera')?.outerHTML || '';
  const conclusionPage = findPageByHeading(doc, 'CONCLUSIONES Y RECOMENDACIONES');
  const body = doc.body;

  tablePages.forEach(page => page.remove());

  const chunks = paginateVoltiaRows(state.elements);

  const insertBefore = conclusionPage || findPageByHeading(doc, 'ANEXO') || body.querySelector('.aviso-plantilla');
  chunks.forEach((chunk, index) => {
    const wrapper = doc.createElement('div');
    wrapper.innerHTML = buildVoltiaElementsPage({
      cabeceraHtml,
      pageNumber: 3 + index,
      rowsHtml: buildVoltiaElementRows(chunk, index === 0),
      showTitle: index === 0
    }).trim();
    body.insertBefore(wrapper.firstElementChild, insertBefore || null);
  });

  const conclusionPageNumber = 3 + chunks.length;
  const annexPageNumber = conclusionPageNumber + 1;
  setPageNumber(conclusionPage, conclusionPageNumber);
  setPageNumber(findPageByHeading(doc, 'ANEXO'), annexPageNumber);
  updateVoltiaToc(doc, conclusionPageNumber, annexPageNumber);
  updateVoltiaConclusion(doc);

  return '<!doctype html>\n' + doc.documentElement.outerHTML;
}

function buildReportHtml() {
  return fillVoltiaTemplate();
}

function generateReport() {
  if (!validateReport()) return;

  try {
    state.reportHtml = buildReportHtml();
  } catch (error) {
    dom.validationSummary.textContent = `No se pudo generar el informe con la plantilla: ${error.message}`;
    dom.validationSummary.classList.remove('hidden');
    return;
  }

  dom.reportPreview.classList.add('voltia-ready');
  dom.reportPreview.innerHTML = `<iframe class="report-frame" title="Vista previa del informe técnico VOLTIA" srcdoc="${escapeHtml(state.reportHtml)}"></iframe>`;
  dom.reportPreview.classList.remove('hidden');
  dom.downloadHtml.disabled = false;
  dom.downloadDoc.disabled = false;
  dom.printReport.disabled = false;
  dom.reportPreview.scrollIntoView({ behavior: 'smooth', block: 'start' });
  saveDraft();
}

function downloadBlob(content, filename, type) {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function safeFilename(value) {
  return normalizeText(value || 'informe-tecnico')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'informe-tecnico';
}

function ensureReportReady() {
  if (!state.reportHtml) generateReport();
  return Boolean(state.reportHtml);
}

function downloadHtml() {
  if (!ensureReportReady()) return;
  const filename = `${safeFilename(state.general.numeroInforme)}.html`;
  downloadBlob(state.reportHtml, filename, 'text/html;charset=utf-8');
}


function escapeXml(value = '') {
  return String(value)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function prepareHtmlForPrint(html) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  const style = doc.createElement('style');
  style.textContent = `
    @page { size: A4; margin: 0; }
    html, body {
      margin: 0 !important;
      padding: 0 !important;
      background: #ffffff !important;
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
      color-adjust: exact !important;
    }
    .page {
      width: 210mm !important;
      min-height: 297mm !important;
      height: 297mm !important;
      margin: 0 auto !important;
      box-shadow: none !important;
      page-break-after: always !important;
      break-after: page !important;
      page-break-inside: avoid !important;
      overflow: hidden !important;
      background: #ffffff !important;
    }
    .page:last-of-type {
      page-break-after: auto !important;
      break-after: auto !important;
    }
    .aviso-plantilla { display: none !important; }
    table { page-break-inside: auto; }
    tr { page-break-inside: avoid; break-inside: avoid; }
  `;
  doc.head.appendChild(style);
  return '<!doctype html>\n' + doc.documentElement.outerHTML;
}


const A4_EXPORT_WIDTH_PX = 794;
const A4_EXPORT_HEIGHT_PX = 1123;
const A4_EXPORT_WIDTH_PT = 595.28;
const A4_EXPORT_HEIGHT_PT = 841.89;
const A4_EXPORT_WIDTH_EMU = 7559040;
const A4_EXPORT_HEIGHT_EMU = 10692000;
const EXPORT_RASTER_SCALE = 2;

function setExportBusy(isBusy, message = '') {
  [dom.downloadDoc, dom.printReport, dom.downloadHtml, dom.generateReport].forEach(button => {
    if (button) button.disabled = isBusy || (!state.reportHtml && button !== dom.generateReport);
  });
  dom.saveStatus.textContent = isBusy ? message : 'Informe listo';
}

const REPORT_RENDER_COLORS = {
  dark: '#123D34',
  text: '#1C463F',
  title: '#123D34',
  olive: '#D6E991',
  tableOlive: '#D4DF92',
  footerDark: '#284038',
  gray: '#51626F',
  line: 'rgba(18, 61, 52, 0.55)',
  border: '#000000',
  headerBorder: '#9ba9a5',
  white: '#ffffff'
};

const A4_MM = { width: 210, height: 297 };
const MM_TO_PX_X = A4_EXPORT_WIDTH_PX / A4_MM.width;
const MM_TO_PX_Y = A4_EXPORT_HEIGHT_PX / A4_MM.height;
const PT_TO_PX = 96 / 72;

function mmX(value) {
  return value * MM_TO_PX_X;
}

function mmY(value) {
  return value * MM_TO_PX_Y;
}

function pt(value) {
  return value * PT_TO_PX;
}

function fontSpec({ sizePt = 9, weight = 400, italic = false } = {}) {
  return `${italic ? 'italic ' : ''}${weight} ${pt(sizePt)}px Lato, Arial, Helvetica, sans-serif`;
}

function setCanvasFont(context, options = {}) {
  context.font = fontSpec(options);
  context.fillStyle = options.color || REPORT_RENDER_COLORS.text;
  context.textBaseline = 'top';
  context.textAlign = options.align || 'left';
}

function drawText(context, text, x, y, options = {}) {
  setCanvasFont(context, options);
  context.fillText(String(text || ''), x, y);
}

function wrapLines(context, text, maxWidth) {
  const words = String(text || '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  const lines = [];
  let line = '';

  words.forEach(word => {
    const testLine = line ? `${line} ${word}` : word;
    if (context.measureText(testLine).width <= maxWidth || !line) {
      line = testLine;
    } else {
      lines.push(line);
      line = word;
    }
  });

  if (line) lines.push(line);
  return lines.length ? lines : [''];
}

function drawWrappedText(context, text, x, y, maxWidth, options = {}) {
  setCanvasFont(context, options);
  const lineHeight = options.lineHeight || pt(options.sizePt || 9) * 1.35;
  const maxLines = options.maxLines || Infinity;
  const lines = wrapLines(context, text, maxWidth).slice(0, maxLines);

  lines.forEach((line, index) => {
    context.fillText(line, x, y + index * lineHeight);
  });

  return lines.length * lineHeight;
}

function drawInlineSegments(context, segments, x, y, maxWidth, options = {}) {
  context.save();
  context.beginPath();
  context.rect(x, y - 1, maxWidth, (options.height || pt(options.sizePt || 9) * 1.4) + 2);
  context.clip();

  let cursor = x;
  segments.forEach(segment => {
    setCanvasFont(context, {
      ...options,
      weight: segment.weight || options.weight || 400,
      italic: segment.italic || false
    });
    const text = String(segment.text || '');
    context.fillText(text, cursor, y);
    cursor += context.measureText(text).width;
  });

  context.restore();
}

function strokeRect(context, x, y, width, height, color = REPORT_RENDER_COLORS.border, lineWidth = 1) {
  context.save();
  context.strokeStyle = color;
  context.lineWidth = lineWidth;
  context.strokeRect(x, y, width, height);
  context.restore();
}

function fillRect(context, x, y, width, height, color) {
  context.fillStyle = color;
  context.fillRect(x, y, width, height);
}

function drawLine(context, x1, y1, x2, y2, color = REPORT_RENDER_COLORS.border, lineWidth = 1) {
  context.save();
  context.strokeStyle = color;
  context.lineWidth = lineWidth;
  context.beginPath();
  context.moveTo(x1, y1);
  context.lineTo(x2, y2);
  context.stroke();
  context.restore();
}

function drawImageContain(context, image, x, y, width, height) {
  if (!image) return;
  const ratio = Math.min(width / image.naturalWidth, height / image.naturalHeight);
  const drawWidth = image.naturalWidth * ratio;
  const drawHeight = image.naturalHeight * ratio;
  context.drawImage(image, x + (width - drawWidth) / 2, y + (height - drawHeight) / 2, drawWidth, drawHeight);
}

function loadReportImage(src) {
  return new Promise(resolve => {
    if (!src) {
      resolve(null);
      return;
    }

    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = src;
  });
}

function textAfterPrefix(text, prefix) {
  return String(text || '').replace(new RegExp(`^${prefix}\\s*:?\\s*`, 'i'), '').trim();
}

function extractVoltiaRenderData(html) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(prepareHtmlForPrint(html), 'text/html');
  const pages = [...doc.querySelectorAll('.page')];
  if (!pages.length) throw new Error('No se han encontrado páginas A4 en el informe.');

  const coverRows = [...doc.querySelectorAll('.caja-datos-principal div')].map(row => row.textContent.trim());
  const infoRows = [...doc.querySelectorAll('.caja-datos-informe div')].map(row => row.textContent.trim());
  const elementTables = [...doc.querySelectorAll('table.tabla-datos')].map(table => {
    return [...table.querySelectorAll('tbody tr')].map(row => {
      const cells = [...row.children].map(cell => cell.textContent.trim());
      return {
        elemento: cells[0] || '',
        valor: cells[1] || '',
        continuidad: cells[2] || '',
        observaciones: cells[3] || '',
        rowHeightMm: Number(row.dataset.rowHeightMm || VOLTIA_TABLE_LAYOUT.minRowHeightMm)
      };
    });
  });

  const conclusionPage = findPageByHeading(doc, 'CONCLUSIONES Y RECOMENDACIONES');
  const annexPage = findPageByHeading(doc, 'ANEXO');

  return {
    totalPages: pages.length,
    logoSrc: doc.querySelector('img.logo')?.getAttribute('src') || '',
    logoDarkSrc: doc.querySelector('img.logo-cab')?.getAttribute('src') || doc.querySelector('img.logo')?.getAttribute('src') || '',
    general: {
      cliente: textAfterPrefix(coverRows[0], 'CLIENTE') || state.general.cliente || '-',
      emplazamiento: textAfterPrefix(coverRows[1], 'EMPLAZAMIENTO') || state.general.emplazamiento || '-',
      instalacion: textAfterPrefix(coverRows[2], 'INSTALACIÓN') || state.general.instalacion || '-',
      numeroInforme: textAfterPrefix(infoRows[1], 'INFORME TÉCNICO Nº') || state.general.numeroInforme || '-'
    },
    longDate: doc.querySelector('.fecha-portada .campo-editable')?.textContent.trim() || formatLongSpanishDate(),
    shortDate: doc.querySelector('.fecha-cab .campo-editable')?.textContent.trim() || formatShortSpanishDate(),
    elementTables,
    conclusion: conclusionPage?.querySelector('.contenido > p:not(.fecha-final)')?.textContent.trim() || '',
    annex: annexPage?.querySelector('.contenido > p')?.textContent.trim() || 'Sin anexos adicionales.'
  };
}

function createReportCanvas(scale) {
  const canvas = document.createElement('canvas');
  canvas.width = A4_EXPORT_WIDTH_PX * scale;
  canvas.height = A4_EXPORT_HEIGHT_PX * scale;
  const context = canvas.getContext('2d');
  context.scale(scale, scale);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  fillRect(context, 0, 0, A4_EXPORT_WIDTH_PX, A4_EXPORT_HEIGHT_PX, REPORT_RENDER_COLORS.white);
  return { canvas, context };
}

function drawCoverPage(context, data, logo) {
  fillRect(context, 0, 0, A4_EXPORT_WIDTH_PX, mmY(93.5), REPORT_RENDER_COLORS.dark);
  drawImageContain(context, logo, mmX(44), mmY(36), mmX(122), mmY(22));

  fillRect(context, 0, mmY(93.5), A4_EXPORT_WIDTH_PX, mmY(195.5), REPORT_RENDER_COLORS.olive);
  fillRect(context, 0, mmY(289), A4_EXPORT_WIDTH_PX, mmY(8), REPORT_RENDER_COLORS.footerDark);

  const left = mmX(18);
  let y = mmY(122.5);
  drawText(context, 'INFORME TÉCNICO', left, y, { sizePt: 16, weight: 900, color: REPORT_RENDER_COLORS.title });
  y += mmY(9);
  drawText(context, 'MEDIDAS REALIZADAS EN LAS TIERRAS DE LA INSTALACIÓN', left, y, { sizePt: 11.5, weight: 900, color: REPORT_RENDER_COLORS.title });

  const boxWidth = mmX(138);
  const rowHeight = mmY(6.8);
  const drawDataBox = (rows, startY) => {
    rows.forEach((row, index) => {
      const rowY = startY + index * rowHeight;
      drawLine(context, left, rowY, left + boxWidth, rowY, REPORT_RENDER_COLORS.line, 0.8);
      drawInlineSegments(context, row, left + mmX(0.8), rowY + mmY(2), boxWidth - mmX(2), { sizePt: 7.5, color: REPORT_RENDER_COLORS.text, height: rowHeight });
    });
    drawLine(context, left, startY + rows.length * rowHeight, left + boxWidth, startY + rows.length * rowHeight, REPORT_RENDER_COLORS.line, 0.8);
  };

  drawDataBox([
    [{ text: 'CLIENTE: ', weight: 900 }, { text: data.general.cliente }],
    [{ text: 'EMPLAZAMIENTO: ', weight: 900 }, { text: data.general.emplazamiento }],
    [{ text: 'INSTALACIÓN: ', weight: 900 }, { text: data.general.instalacion }]
  ], mmY(154));

  drawDataBox([
    [{ text: 'COVER VERIFICACIONES ELÉCTRICAS, S.A.', weight: 900 }],
    [{ text: 'INFORME TÉCNICO Nº: ', weight: 900 }, { text: data.general.numeroInforme }],
    [{ text: 'PERIODO DE REVISIÓN: ', weight: 900 }, { text: 'TRIMESTRAL' }]
  ], mmY(194.5));

  drawText(context, `VALENCIA, ${data.longDate}`, mmX(191), mmY(258), {
    sizePt: 8,
    weight: 900,
    color: REPORT_RENDER_COLORS.text,
    align: 'right'
  });

  drawText(context, 'voltia.es', mmX(201), mmY(291.7), {
    sizePt: 8,
    weight: 900,
    color: REPORT_RENDER_COLORS.olive,
    align: 'right'
  });
}

function drawInteriorHeader(context, data, logoDark) {
  drawImageContain(context, logoDark, mmX(18), mmY(10), mmX(39), mmY(9));

  const tableX = mmX(67);
  const tableY = mmY(9.5);
  const labelWidth = mmX(28);
  const valueWidth = mmX(97);
  const rowHeight = mmY(4.2);
  const rows = [
    ['CLIENTE:', data.general.cliente],
    ['EMPLAZAMIENTO:', data.general.emplazamiento],
    ['INSTALACIÓN:', data.general.instalacion]
  ];

  rows.forEach((row, index) => {
    const y = tableY + index * rowHeight;
    fillRect(context, tableX, y, labelWidth, rowHeight, REPORT_RENDER_COLORS.dark);
    strokeRect(context, tableX, y, labelWidth, rowHeight, REPORT_RENDER_COLORS.headerBorder, 0.7);
    strokeRect(context, tableX + labelWidth, y, valueWidth, rowHeight, REPORT_RENDER_COLORS.headerBorder, 0.7);
    drawText(context, row[0], tableX + mmX(1), y + mmY(0.7), { sizePt: 6.1, weight: 900, color: REPORT_RENDER_COLORS.olive });
    drawText(context, row[1], tableX + labelWidth + mmX(1), y + mmY(0.6), { sizePt: 6.4, color: REPORT_RENDER_COLORS.text });
  });

  const metaY = tableY + rows.length * rowHeight + mmY(3.2);
  drawText(context, `Informe técnico: ${data.general.numeroInforme}`, tableX + mmX(62.5), metaY, {
    sizePt: 6.2,
    color: REPORT_RENDER_COLORS.text,
    align: 'center'
  });
  drawText(context, `Fecha:${data.shortDate}`, tableX + mmX(125), metaY, {
    sizePt: 6.2,
    color: REPORT_RENDER_COLORS.text,
    align: 'right'
  });
}

function drawInteriorFooter(context, pageNumber, totalPages) {
  const y = mmY(289);
  fillRect(context, 0, y, A4_EXPORT_WIDTH_PX, mmY(8), REPORT_RENDER_COLORS.olive);
  drawText(context, 'Rev.00', mmX(11), y + mmY(2.5), { sizePt: 5.7, color: REPORT_RENDER_COLORS.text });
  drawText(context, `Página ${pageNumber} de ${totalPages}`, mmX(105), y + mmY(2.5), {
    sizePt: 5.7,
    color: REPORT_RENDER_COLORS.text,
    align: 'center'
  });
  drawText(context, 'voltia.es', mmX(199), y + mmY(1.9), {
    sizePt: 8,
    weight: 900,
    color: REPORT_RENDER_COLORS.text,
    align: 'right'
  });
}

function drawInteriorScaffold(context, data, logoDark, pageNumber) {
  drawInteriorHeader(context, data, logoDark);
  drawInteriorFooter(context, pageNumber, data.totalPages);
}

function drawSectionTitle(context, title, x, y, options = {}) {
  drawText(context, title.toUpperCase(), x, y, {
    sizePt: 14,
    weight: 900,
    color: REPORT_RENDER_COLORS.title,
    align: options.align || 'left'
  });
}

function drawIndexPage(context, data, logoDark) {
  drawInteriorScaffold(context, data, logoDark, 2);
  const y = mmY(66);
  drawSectionTitle(context, 'Índice', mmX(105), y, { align: 'center' });

  const conclusionPage = 3 + data.elementTables.length;
  const annexPage = conclusionPage + 1;
  const items = [
    ['1', 'ELEMENTOS REVISADOS', '3'],
    ['2', 'CONCLUSIONES Y RECOMENDACIONES', String(conclusionPage)],
    ['3', 'ANEXO.', String(annexPage)]
  ];

  let itemY = y + mmY(18);
  items.forEach(item => {
    const x = mmX(20);
    drawText(context, item[0], x, itemY, { sizePt: 10, weight: 700, color: REPORT_RENDER_COLORS.text });
    drawText(context, item[1], x + mmX(8), itemY, { sizePt: 10, weight: 700, color: REPORT_RENDER_COLORS.text });
    const pageX = mmX(185);
    drawText(context, item[2], pageX, itemY, { sizePt: 10, weight: 700, color: REPORT_RENDER_COLORS.text, align: 'right' });
    drawLine(context, x + mmX(78), itemY + mmY(3.4), pageX - mmX(4), itemY + mmY(3.4), REPORT_RENDER_COLORS.text, 1);
    itemY += mmY(10);
  });
}

function drawTableCellText(context, text, x, y, width, height, options = {}) {
  context.save();
  context.beginPath();
  context.rect(x + mmX(1.5), y + mmY(0.8), width - mmX(3), height - mmY(1.2));
  context.clip();
  const textX = options.align === 'center' ? x + width / 2 : x + mmX(2);
  drawWrappedText(context, text, textX, y + mmY(1.2), width - mmX(4), {
    sizePt: options.sizePt || 9,
    weight: options.weight || 400,
    color: REPORT_RENDER_COLORS.text,
    lineHeight: pt(options.sizePt || 9) * 1.15,
    maxLines: options.maxLines || Infinity,
    align: options.align || 'left'
  });
  context.restore();
}

function drawElementsTable(context, rows, x, y) {
  const width = mmX(VOLTIA_TABLE_LAYOUT.widthMm);
  const colWidths = VOLTIA_TABLE_LAYOUT.colFractions.map(value => width * value);
  const headerHeight = mmY(VOLTIA_TABLE_LAYOUT.headerHeightMm);
  const headers = ['LÍNEA', 'VALOR (Ω)', 'CONTINUIDAD', 'OBSERVACIONES'];

  let cursorX = x;
  headers.forEach((header, index) => {
    const cellWidth = colWidths[index];
    fillRect(context, cursorX, y, cellWidth, headerHeight, REPORT_RENDER_COLORS.tableOlive);
    strokeRect(context, cursorX, y, cellWidth, headerHeight, REPORT_RENDER_COLORS.border, 1);
    drawText(context, header, cursorX + cellWidth / 2, y + mmY(2.5), {
      sizePt: 9,
      weight: 700,
      color: REPORT_RENDER_COLORS.text,
      align: 'center'
    });
    cursorX += cellWidth;
  });

  let rowY = y + headerHeight;
  rows.forEach(row => {
    const rowHeight = mmY(Number(row.rowHeightMm || VOLTIA_TABLE_LAYOUT.minRowHeightMm));
    const values = [row.elemento, row.valor, row.continuidad, row.observaciones];
    cursorX = x;
    values.forEach((value, index) => {
      const cellWidth = colWidths[index];
      strokeRect(context, cursorX, rowY, cellWidth, rowHeight, REPORT_RENDER_COLORS.border, 0.7);
      drawTableCellText(context, value, cursorX, rowY, cellWidth, rowHeight, {
        sizePt: 9,
        maxLines: index === 1 || index === 2 ? 1 : Infinity,
        align: index === 1 || index === 2 ? 'center' : 'left'
      });
      cursorX += cellWidth;
    });
    rowY += rowHeight;
  });
}

function drawElementsPage(context, data, logoDark, rows, pageNumber, showTitle) {
  drawInteriorScaffold(context, data, logoDark, pageNumber);
  const contentX = mmX(20);
  const titleY = mmY(46);
  const tableY = showTitle ? mmY(58) : mmY(52);

  if (showTitle) {
    drawSectionTitle(context, '1  ELEMENTOS REVISADOS', contentX, titleY);
  }

  drawElementsTable(context, rows, contentX, tableY);
}

function drawSignatureTable(context, x, y) {
  const width = mmX(170);
  const cellWidth = width / 2;
  const firstHeight = mmY(32);
  const secondHeight = mmY(10);
  const labels = ['Por VOLTIA:', 'Por la propiedad / cliente:'];

  labels.forEach((label, index) => {
    const cellX = x + index * cellWidth;
    strokeRect(context, cellX, y, cellWidth, firstHeight, REPORT_RENDER_COLORS.border, 0.7);
    drawText(context, label, cellX + mmX(4), y + mmY(3), { sizePt: 9, weight: 700, color: REPORT_RENDER_COLORS.text });
    strokeRect(context, cellX, y + firstHeight, cellWidth, secondHeight, REPORT_RENDER_COLORS.border, 0.7);
    drawText(context, 'Fdo.:', cellX + mmX(4), y + firstHeight + mmY(3), { sizePt: 9, weight: 700, color: REPORT_RENDER_COLORS.text });
  });
}

function drawConclusionPage(context, data, logoDark, pageNumber) {
  drawInteriorScaffold(context, data, logoDark, pageNumber);
  const contentX = mmX(20);
  let y = mmY(46);
  drawSectionTitle(context, '2  CONCLUSIONES Y RECOMENDACIONES', contentX, y);
  y += mmY(13);
  const paragraphHeight = drawWrappedText(context, data.conclusion, contentX, y, mmX(170), {
    sizePt: 9,
    color: REPORT_RENDER_COLORS.text,
    lineHeight: pt(9) * 1.45
  });
  y += paragraphHeight + mmY(10);
  drawSignatureTable(context, contentX, y);
  drawText(context, data.longDate, mmX(105), y + mmY(54), {
    sizePt: 10.5,
    weight: 700,
    italic: true,
    color: REPORT_RENDER_COLORS.text,
    align: 'center'
  });
}

function drawAnnexPage(context, data, logoDark, pageNumber) {
  drawInteriorScaffold(context, data, logoDark, pageNumber);
  const contentX = mmX(20);
  let y = mmY(46);
  drawSectionTitle(context, '3  ANEXO.', contentX, y);
  y += mmY(13);
  drawWrappedText(context, data.annex, contentX, y, mmX(170), {
    sizePt: 9,
    color: REPORT_RENDER_COLORS.text,
    lineHeight: pt(9) * 1.45
  });
}

async function canvasToJpegPage(canvas) {
  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.94));
  if (!blob) throw new Error('No se pudo convertir una página del informe en imagen.');
  return {
    bytes: new Uint8Array(await blob.arrayBuffer()),
    width: canvas.width,
    height: canvas.height
  };
}

async function rasterizeReportPages(html, scale = EXPORT_RASTER_SCALE) {
  const data = extractVoltiaRenderData(html);
  const [logo, logoDark] = await Promise.all([
    loadReportImage(data.logoSrc),
    loadReportImage(data.logoDarkSrc || data.logoSrc)
  ]);

  const canvases = [];
  const addPage = drawCallback => {
    const { canvas, context } = createReportCanvas(scale);
    drawCallback(context);
    canvases.push(canvas);
  };

  addPage(context => drawCoverPage(context, data, logo));
  addPage(context => drawIndexPage(context, data, logoDark || logo));
  data.elementTables.forEach((rows, index) => {
    addPage(context => drawElementsPage(context, data, logoDark || logo, rows, 3 + index, index === 0));
  });
  addPage(context => drawConclusionPage(context, data, logoDark || logo, 3 + data.elementTables.length));
  addPage(context => drawAnnexPage(context, data, logoDark || logo, 4 + data.elementTables.length));

  return Promise.all(canvases.map(canvasToJpegPage));
}

function concatParts(parts) {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const output = new Uint8Array(total);
  let offset = 0;
  parts.forEach(part => {
    output.set(part, offset);
    offset += part.length;
  });
  return output;
}

function stringBytes(value) {
  return new TextEncoder().encode(value);
}

function createPdfFromPageImages(pageImages) {
  const parts = [];
  const offsets = [0];
  let position = 0;

  const pushBytes = bytes => {
    parts.push(bytes);
    position += bytes.length;
  };
  const pushString = value => pushBytes(stringBytes(value));
  const addObject = (objectNumber, bodyParts) => {
    offsets[objectNumber] = position;
    pushString(`${objectNumber} 0 obj\n`);
    bodyParts.forEach(part => typeof part === 'string' ? pushString(part) : pushBytes(part));
    pushString('\nendobj\n');
  };

  pushString('%PDF-1.4\n%\xFF\xFF\xFF\xFF\n');

  const pageObjectNumbers = pageImages.map((_, index) => 3 + index * 3);
  addObject(1, ['<< /Type /Catalog /Pages 2 0 R >>']);
  addObject(2, [`<< /Type /Pages /Kids [${pageObjectNumbers.map(num => `${num} 0 R`).join(' ')}] /Count ${pageImages.length} >>`]);

  pageImages.forEach((page, index) => {
    const pageObj = 3 + index * 3;
    const contentObj = pageObj + 1;
    const imageObj = pageObj + 2;
    const imageName = `Im${index + 1}`;
    const content = `q\n${A4_EXPORT_WIDTH_PT} 0 0 ${A4_EXPORT_HEIGHT_PT} 0 0 cm\n/${imageName} Do\nQ`;

    addObject(pageObj, [`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${A4_EXPORT_WIDTH_PT} ${A4_EXPORT_HEIGHT_PT}] /Resources << /XObject << /${imageName} ${imageObj} 0 R >> >> /Contents ${contentObj} 0 R >>`]);
    addObject(contentObj, [`<< /Length ${stringBytes(content).length} >>\nstream\n${content}\nendstream`]);
    addObject(imageObj, [
      `<< /Type /XObject /Subtype /Image /Width ${page.width} /Height ${page.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${page.bytes.length} >>\nstream\n`,
      page.bytes,
      '\nendstream'
    ]);
  });

  const xrefStart = position;
  const objectCount = 2 + pageImages.length * 3;
  pushString(`xref\n0 ${objectCount + 1}\n`);
  pushString('0000000000 65535 f \n');
  for (let objectNumber = 1; objectNumber <= objectCount; objectNumber += 1) {
    pushString(`${String(offsets[objectNumber]).padStart(10, '0')} 00000 n \n`);
  }
  pushString(`trailer\n<< /Size ${objectCount + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`);

  return new Blob([concatParts(parts)], { type: 'application/pdf' });
}

function wFullPageImageRun({ relationshipId, index }) {
  return `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${A4_EXPORT_WIDTH_EMU}" cy="${A4_EXPORT_HEIGHT_EMU}"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:docPr id="${1000 + index}" name="Página ${index}"/><wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="${2000 + index}" name="Página ${index}.jpg"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${relationshipId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${A4_EXPORT_WIDTH_EMU}" cy="${A4_EXPORT_HEIGHT_EMU}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
}

function buildImageDocxBlob(pageImages) {
  const body = pageImages.map((_, index) => {
    const imageRun = wFullPageImageRun({ relationshipId: `rIdPage${index + 1}`, index: index + 1 });
    const pageBreakBefore = index > 0 ? '<w:pageBreakBefore/>' : '';
    return `<w:p><w:pPr>${pageBreakBefore}<w:spacing w:before="0" w:after="0"/><w:jc w:val="center"/></w:pPr>${imageRun}</w:p>`;
  }).join('');

  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="0" w:right="0" w:bottom="0" w:left="0" w:header="0" w:footer="0" w:gutter="0"/></w:sectPr></w:body></w:document>`;

  const relationships = pageImages.map((_, index) => `<Relationship Id="rIdPage${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/page-${index + 1}.jpg"/>`).join('');
  const files = [
    { name: '[Content_Types].xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="jpg" ContentType="image/jpeg"/><Default Extension="jpeg" ContentType="image/jpeg"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/></Types>` },
    { name: '_rels/.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>` },
    { name: 'word/document.xml', data: documentXml },
    { name: 'word/styles.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="20"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:before="0" w:after="0"/></w:pPr></w:pPrDefault></w:docDefaults></w:styles>` },
    { name: 'word/settings.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:zoom w:percent="100"/><w:defaultTabStop w:val="708"/></w:settings>` },
    { name: 'word/_rels/document.xml.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${relationships}</Relationships>` },
    ...pageImages.map((page, index) => ({ name: `word/media/page-${index + 1}.jpg`, data: page.bytes }))
  ];

  return new Blob([createZip(files)], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
}

function getReportLogoBytes(selector = 'img.logo') {
  const template = window.VOLTIA_REPORT_TEMPLATE || '';
  try {
    const doc = new DOMParser().parseFromString(template, 'text/html');
    const image = doc.querySelector(selector);
    const match = image?.getAttribute('src')?.match(/^data:image\/png;base64,(.+)$/);
    if (match) return base64ToUint8Array(match[1]);
  } catch (error) {
    // Se deja una ruta de reserva por si el navegador no permite parsear la plantilla aquí.
  }
  const fallback = template.match(/src="data:image\/png;base64,([^"]+)"/);
  if (!fallback) return null;
  return base64ToUint8Array(fallback[1]);
}

function base64ToUint8Array(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function crc32(bytes) {
  let table = crc32.table;
  if (!table) {
    table = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) {
        c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
      }
      table[n] = c >>> 0;
    }
    crc32.table = table;
  }

  let crc = 0xffffffff;
  for (let index = 0; index < bytes.length; index += 1) {
    crc = table[(crc ^ bytes[index]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date = new Date()) {
  const time = ((date.getHours() & 0x1f) << 11) | ((date.getMinutes() & 0x3f) << 5) | Math.floor(date.getSeconds() / 2);
  const year = Math.max(date.getFullYear(), 1980) - 1980;
  const day = ((year & 0x7f) << 9) | (((date.getMonth() + 1) & 0xf) << 5) | (date.getDate() & 0x1f);
  return { time, day };
}

function concatUint8Arrays(parts) {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const output = new Uint8Array(total);
  let offset = 0;
  parts.forEach(part => {
    output.set(part, offset);
    offset += part.length;
  });
  return output;
}

function createZip(files) {
  const encoder = new TextEncoder();
  const localParts = [];
  const centralParts = [];
  const { time, day } = dosDateTime();
  let offset = 0;

  files.forEach(file => {
    const nameBytes = encoder.encode(file.name);
    const dataBytes = typeof file.data === 'string' ? encoder.encode(file.data) : file.data;
    const checksum = crc32(dataBytes);

    const localHeader = new Uint8Array(30 + nameBytes.length);
    const localView = new DataView(localHeader.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(6, 0x0800, true);
    localView.setUint16(8, 0, true);
    localView.setUint16(10, time, true);
    localView.setUint16(12, day, true);
    localView.setUint32(14, checksum, true);
    localView.setUint32(18, dataBytes.length, true);
    localView.setUint32(22, dataBytes.length, true);
    localView.setUint16(26, nameBytes.length, true);
    localView.setUint16(28, 0, true);
    localHeader.set(nameBytes, 30);

    const centralHeader = new Uint8Array(46 + nameBytes.length);
    const centralView = new DataView(centralHeader.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint16(8, 0x0800, true);
    centralView.setUint16(10, 0, true);
    centralView.setUint16(12, time, true);
    centralView.setUint16(14, day, true);
    centralView.setUint32(16, checksum, true);
    centralView.setUint32(20, dataBytes.length, true);
    centralView.setUint32(24, dataBytes.length, true);
    centralView.setUint16(28, nameBytes.length, true);
    centralView.setUint16(30, 0, true);
    centralView.setUint16(32, 0, true);
    centralView.setUint16(34, 0, true);
    centralView.setUint16(36, 0, true);
    centralView.setUint32(38, 0, true);
    centralView.setUint32(42, offset, true);
    centralHeader.set(nameBytes, 46);

    localParts.push(localHeader, dataBytes);
    centralParts.push(centralHeader);
    offset += localHeader.length + dataBytes.length;
  });

  const centralDirOffset = offset;
  const centralDirSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const eocd = new Uint8Array(22);
  const eocdView = new DataView(eocd.buffer);
  eocdView.setUint32(0, 0x06054b50, true);
  eocdView.setUint16(4, 0, true);
  eocdView.setUint16(6, 0, true);
  eocdView.setUint16(8, files.length, true);
  eocdView.setUint16(10, files.length, true);
  eocdView.setUint32(12, centralDirSize, true);
  eocdView.setUint32(16, centralDirOffset, true);
  eocdView.setUint16(20, 0, true);

  return concatUint8Arrays([...localParts, ...centralParts, eocd]);
}

function wRun(text, options = {}) {
  const props = [];
  if (options.bold) props.push('<w:b/>');
  if (options.italic) props.push('<w:i/>');
  if (options.color) props.push(`<w:color w:val="${options.color}"/>`);
  if (options.size) props.push(`<w:sz w:val="${options.size}"/><w:szCs w:val="${options.size}"/>`);
  const pr = props.length ? `<w:rPr>${props.join('')}</w:rPr>` : '';
  return `<w:r>${pr}<w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r>`;
}

function wParagraph(runs = '', options = {}) {
  const pPr = [];
  if (options.align) pPr.push(`<w:jc w:val="${options.align}"/>`);
  if (options.spacingAfter !== undefined || options.spacingBefore !== undefined) {
    pPr.push(`<w:spacing w:before="${options.spacingBefore || 0}" w:after="${options.spacingAfter || 0}"/>`);
  }
  if (options.indentLeft || options.indentRight) {
    pPr.push(`<w:ind w:left="${options.indentLeft || 0}" w:right="${options.indentRight || 0}"/>`);
  }
  const pr = pPr.length ? `<w:pPr>${pPr.join('')}</w:pPr>` : '';
  return `<w:p>${pr}${runs}</w:p>`;
}

function wTextParagraph(text, options = {}) {
  return wParagraph(wRun(text, options), options);
}

function wPageBreak() {
  return '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
}

function wImageRun({ relationshipId = 'rIdLogo', cx = 4320000, cy = 590000, name = 'Logo VOLTIA' } = {}) {
  const drawingId = wImageRun.nextId || 1;
  wImageRun.nextId = drawingId + 1;
  return `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:docPr id="${drawingId}" name="${escapeXml(name)}"/><wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="${drawingId}" name="${escapeXml(name)}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${relationshipId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
}

function wCell(content, options = {}) {
  const pr = [];
  pr.push(`<w:tcW w:w="${options.width || 2400}" w:type="dxa"/>`);
  if (options.fill) pr.push(`<w:shd w:fill="${options.fill}"/>`);
  if (options.vAlign) pr.push(`<w:vAlign w:val="${options.vAlign}"/>`);
  if (options.gridSpan) pr.push(`<w:gridSpan w:val="${options.gridSpan}"/>`);
  const margins = options.margins || { top: 90, left: 120, bottom: 90, right: 120 };
  pr.push(`<w:tcMar><w:top w:w="${margins.top}" w:type="dxa"/><w:left w:w="${margins.left}" w:type="dxa"/><w:bottom w:w="${margins.bottom}" w:type="dxa"/><w:right w:w="${margins.right}" w:type="dxa"/></w:tcMar>`);
  return `<w:tc><w:tcPr>${pr.join('')}</w:tcPr>${content || wParagraph()}</w:tc>`;
}

function wRow(cells, options = {}) {
  const trPr = options.height ? `<w:trPr><w:trHeight w:val="${options.height}" w:hRule="${options.heightRule || 'atLeast'}"/></w:trPr>` : '';
  return `<w:tr>${trPr}${cells.join('')}</w:tr>`;
}

function wTable(rows, options = {}) {
  const width = options.width || 9638;
  const indent = options.indent || 0;
  const borders = options.noBorders
    ? '<w:tblBorders><w:top w:val="nil"/><w:left w:val="nil"/><w:bottom w:val="nil"/><w:right w:val="nil"/><w:insideH w:val="nil"/><w:insideV w:val="nil"/></w:tblBorders>'
    : '<w:tblBorders><w:top w:val="single" w:sz="8"/><w:left w:val="single" w:sz="8"/><w:bottom w:val="single" w:sz="8"/><w:right w:val="single" w:sz="8"/><w:insideH w:val="single" w:sz="6"/><w:insideV w:val="single" w:sz="6"/></w:tblBorders>';
  return `<w:tbl><w:tblPr><w:tblW w:w="${width}" w:type="dxa"/><w:tblInd w:w="${indent}" w:type="dxa"/>${borders}<w:tblLayout w:type="fixed"/></w:tblPr>${rows.join('')}</w:tbl>`;
}

function buildDocxCover(hasLogo) {
  const logo = hasLogo
    ? wParagraph(wImageRun({ relationshipId: 'rIdLogo', cx: 4392000, cy: 600000, name: 'Logo VOLTIA portada' }), { align: 'center', spacingAfter: 0 })
    : wParagraph('', { spacingAfter: 0 });

  const topContent = logo;
  const fieldTable = wTable([
    wRow([wCell(wTextParagraph(`CLIENTE: ${state.general.cliente || '-'}`, { bold: true, size: 15, color: '1C463F', spacingAfter: 0 }), { width: 7824 })], { height: 385, heightRule: 'exact' }),
    wRow([wCell(wTextParagraph(`EMPLAZAMIENTO: ${state.general.emplazamiento || '-'}`, { bold: true, size: 15, color: '1C463F', spacingAfter: 0 }), { width: 7824 })], { height: 385, heightRule: 'exact' }),
    wRow([wCell(wTextParagraph(`INSTALACIÓN: ${state.general.instalacion || '-'}`, { bold: true, size: 15, color: '1C463F', spacingAfter: 0 }), { width: 7824 })], { height: 385, heightRule: 'exact' })
  ], { width: 7824, indent: 0 });

  const infoTable = wTable([
    wRow([wCell(wTextParagraph('COVER VERIFICACIONES ELÉCTRICAS, S.A.', { bold: true, size: 15, color: '1C463F', spacingAfter: 0 }), { width: 7824 })], { height: 385, heightRule: 'exact' }),
    wRow([wCell(wTextParagraph(`INFORME TÉCNICO Nº: ${state.general.numeroInforme || '-'}`, { bold: true, size: 15, color: '1C463F', spacingAfter: 0 }), { width: 7824 })], { height: 385, heightRule: 'exact' }),
    wRow([wCell(wTextParagraph('PERIODO DE REVISIÓN: TRIMESTRAL', { bold: true, size: 15, color: '1C463F', spacingAfter: 0 }), { width: 7824 })], { height: 385, heightRule: 'exact' })
  ], { width: 7824, indent: 0 });

  const bottomContent = [
    wTextParagraph('INFORME TÉCNICO', { bold: true, size: 32, color: '1C463F', spacingAfter: 160 }),
    wTextParagraph('MEDIDAS REALIZADAS EN LAS TIERRAS DE LA INSTALACIÓN', { bold: true, size: 23, color: '1C463F', spacingAfter: 960 }),
    fieldTable,
    wParagraph('', { spacingAfter: 850 }),
    infoTable,
    wTextParagraph(`VALENCIA, ${formatLongSpanishDate()}`, { align: 'right', bold: true, size: 16, color: '1C463F', spacingBefore: 1250, spacingAfter: 0 })
  ].join('');

  const footer = wTextParagraph('voltia.es', { align: 'right', bold: true, size: 16, color: 'D6E991', spacingAfter: 0 });

  return wTable([
    wRow([wCell(topContent, { width: 11906, fill: '123D34', vAlign: 'center', margins: { top: 0, left: 400, bottom: 0, right: 400 } })], { height: 5301, heightRule: 'exact' }),
    wRow([wCell(bottomContent, { width: 11906, fill: 'D6E991', vAlign: 'top', margins: { top: 1644, left: 1020, bottom: 0, right: 1077 } })], { height: 10845, heightRule: 'exact' }),
    wRow([wCell(footer, { width: 11906, fill: '284038', vAlign: 'center', margins: { top: 0, left: 0, bottom: 0, right: 510 } })], { height: 454, heightRule: 'exact' })
  ], { width: 11906, noBorders: true });
}

function buildDocxFooterContent(pageNumber, totalPages) {
  return wTable([
    wRow([
      wCell(wTextParagraph('Rev.00', { size: 11, color: '1C463F', spacingAfter: 0 }), { width: 3968, fill: 'D6E991', margins: { top: 0, left: 620, bottom: 0, right: 0 }, vAlign: 'center' }),
      wCell(wTextParagraph(`Página ${pageNumber} de ${totalPages}`, { align: 'center', size: 11, color: '1C463F', spacingAfter: 0 }), { width: 3969, fill: 'D6E991', margins: { top: 0, left: 0, bottom: 0, right: 0 }, vAlign: 'center' }),
      wCell(wTextParagraph('voltia.es', { align: 'right', bold: true, size: 16, color: '1C463F', spacingAfter: 0 }), { width: 3969, fill: 'D6E991', margins: { top: 0, left: 0, bottom: 0, right: 620 }, vAlign: 'center' })
    ], { height: 454, heightRule: 'exact' })
  ], { width: 11906, noBorders: true });
}

function buildDocxHeaderContent(hasLogoDark) {
  const logo = hasLogoDark
    ? wParagraph(wImageRun({ relationshipId: 'rIdLogoDark', cx: 1404000, cy: 192000, name: 'Logo VOLTIA cabecera' }), { align: 'left', spacingAfter: 0 })
    : wTextParagraph('VOLTIA', { bold: true, size: 24, color: '123D34', spacingAfter: 0 });

  const labelOptions = { bold: true, size: 12, color: 'D6E991', spacingAfter: 0 };
  const valueOptions = { size: 12, color: '1C463F', spacingAfter: 0 };
  const dataTable = wTable([
    wRow([
      wCell(wTextParagraph('CLIENTE:', labelOptions), { width: 1700, fill: '123D34', margins: { top: 35, left: 70, bottom: 35, right: 70 } }),
      wCell(wTextParagraph(state.general.cliente || '', valueOptions), { width: 5900, margins: { top: 35, left: 70, bottom: 35, right: 70 } })
    ], { height: 235, heightRule: 'exact' }),
    wRow([
      wCell(wTextParagraph('EMPLAZAMIENTO:', labelOptions), { width: 1700, fill: '123D34', margins: { top: 35, left: 70, bottom: 35, right: 70 } }),
      wCell(wTextParagraph(state.general.emplazamiento || '', valueOptions), { width: 5900, margins: { top: 35, left: 70, bottom: 35, right: 70 } })
    ], { height: 235, heightRule: 'exact' }),
    wRow([
      wCell(wTextParagraph('INSTALACIÓN:', labelOptions), { width: 1700, fill: '123D34', margins: { top: 35, left: 70, bottom: 35, right: 70 } }),
      wCell(wTextParagraph(state.general.instalacion || '', valueOptions), { width: 5900, margins: { top: 35, left: 70, bottom: 35, right: 70 } })
    ], { height: 235, heightRule: 'exact' })
  ], { width: 7600 });

  const metaTable = wTable([
    wRow([
      wCell(wTextParagraph(`Informe técnico: ${state.general.numeroInforme || ''}`, { align: 'center', size: 12, color: '1C463F', spacingAfter: 0 }), { width: 3800, margins: { top: 110, left: 0, bottom: 0, right: 0 } }),
      wCell(wTextParagraph(`Fecha:${formatShortSpanishDate()}`, { align: 'right', size: 12, color: '1C463F', spacingAfter: 0 }), { width: 3800, margins: { top: 110, left: 0, bottom: 0, right: 0 } })
    ])
  ], { width: 7600, noBorders: true });

  return wTable([
    wRow([
      wCell(logo, { width: 2550, margins: { top: 0, left: 0, bottom: 0, right: 0 }, vAlign: 'top' }),
      wCell(dataTable + metaTable, { width: 7600, margins: { top: 0, left: 0, bottom: 0, right: 0 }, vAlign: 'top' })
    ])
  ], { width: 10150, indent: 1020, noBorders: true });
}

function buildDocxPage(content, pageNumber, totalPages, hasLogoDark) {
  return wTable([
    wRow([wCell(buildDocxHeaderContent(hasLogoDark), { width: 11906, margins: { top: 539, left: 0, bottom: 0, right: 0 }, vAlign: 'top' })], { height: 1928, heightRule: 'exact' }),
    wRow([wCell(content, { width: 11906, margins: { top: 0, left: 0, bottom: 0, right: 0 }, vAlign: 'top' })], { height: 14218, heightRule: 'exact' }),
    wRow([wCell(buildDocxFooterContent(pageNumber, totalPages), { width: 11906, fill: 'D6E991', margins: { top: 0, left: 0, bottom: 0, right: 0 }, vAlign: 'center' })], { height: 454, heightRule: 'exact' })
  ], { width: 11906, noBorders: true });
}

function buildDocxToc(conclusionPageNumber, annexPageNumber, totalPages, hasLogoDark) {
  const content = [
    wTextParagraph('ÍNDICE', { bold: true, size: 28, color: '123D34', indentLeft: 1134, spacingAfter: 460 }),
    wTextParagraph(`1   ELEMENTOS REVISADOS ........................................ 3`, { bold: true, size: 20, color: '1C463F', indentLeft: 1134, spacingAfter: 240 }),
    wTextParagraph(`2   CONCLUSIONES Y RECOMENDACIONES ....................... ${conclusionPageNumber}`, { bold: true, size: 20, color: '1C463F', indentLeft: 1134, spacingAfter: 240 }),
    wTextParagraph(`3   ANEXO ........................................................................... ${annexPageNumber}`, { bold: true, size: 20, color: '1C463F', indentLeft: 1134, spacingAfter: 0 })
  ].join('');
  return buildDocxPage(content, 2, totalPages, hasLogoDark);
}

function buildDocxElementsPage(elements, pageNumber, showTitle, totalPages, hasLogoDark) {
  const widths = [3300, 1800, 1800, 2738];
  const header = wRow([
    wCell(wTextParagraph('LÍNEA', { align: 'center', bold: true, size: 18, color: '1C463F', spacingAfter: 0 }), { width: widths[0], fill: 'D4DF92' }),
    wCell(wTextParagraph('VALOR (Ω)', { align: 'center', bold: true, size: 18, color: '1C463F', spacingAfter: 0 }), { width: widths[1], fill: 'D4DF92' }),
    wCell(wTextParagraph('CONTINUIDAD', { align: 'center', bold: true, size: 18, color: '1C463F', spacingAfter: 0 }), { width: widths[2], fill: 'D4DF92' }),
    wCell(wTextParagraph('OBSERVACIONES', { align: 'center', bold: true, size: 18, color: '1C463F', spacingAfter: 0 }), { width: widths[3], fill: 'D4DF92' })
  ], { height: 450 });

  const rows = [...elements];
  while (rows.length < VOLTIA_ROWS_PER_PAGE) rows.push(null);
  const bodyRows = rows.map(element => wRow([
    wCell(wTextParagraph(element?.elemento || '', { size: 18, color: '1C463F', spacingAfter: 0 }), { width: widths[0] }),
    wCell(wTextParagraph(element?.valor || '', { size: 18, color: '1C463F', spacingAfter: 0 }), { width: widths[1] }),
    wCell(wTextParagraph(element?.continuidad || '', { size: 18, color: '1C463F', spacingAfter: 0 }), { width: widths[2] }),
    wCell(wTextParagraph(element?.observaciones || '', { size: 18, color: '1C463F', spacingAfter: 0 }), { width: widths[3] })
  ], { height: 470 }));

  const content = [
    showTitle ? wTextParagraph('1   ELEMENTOS REVISADOS', { bold: true, size: 28, color: '123D34', indentLeft: 1134, spacingAfter: 340 }) : wParagraph('', { spacingAfter: 340 }),
    wTable([header, ...bodyRows], { width: 9638, indent: 1134 })
  ].join('');
  return buildDocxPage(content, pageNumber, totalPages, hasLogoDark);
}

function buildDocxConclusion(pageNumber, totalPages, hasLogoDark) {
  const withoutContinuity = state.elements.filter(element => normalizeText(element.continuidad) === 'no');
  const withObservations = state.elements.filter(element => (element.observaciones || '').trim());
  let conclusion = 'Efectuada la inspección de tierras en sus instalaciones eléctricas, no se han detectado puntos que necesiten revisión.';
  if (withoutContinuity.length) {
    conclusion = `Efectuada la inspección de tierras en sus instalaciones eléctricas, se han registrado ${withoutContinuity.length} elemento(s) sin continuidad. Se recomienda revisar los puntos indicados en la tabla de elementos revisados y valorar las observaciones técnicas asociadas.`;
  } else if (withObservations.length) {
    conclusion = 'Efectuada la inspección de tierras en sus instalaciones eléctricas, no se han detectado puntos sin continuidad. Se dejan reflejadas las observaciones técnicas indicadas en la tabla para su seguimiento.';
  }

  const signatureTable = wTable([
    wRow([
      wCell(wTextParagraph('Por VOLTIA:', { bold: true, size: 18, color: '1C463F', spacingAfter: 0 }), { width: 4819 }),
      wCell(wTextParagraph('Por la propiedad / cliente:', { bold: true, size: 18, color: '1C463F', spacingAfter: 0 }), { width: 4819 })
    ], { height: 1700 }),
    wRow([
      wCell(wTextParagraph('Fdo.:', { bold: true, size: 18, color: '1C463F', spacingAfter: 0 }), { width: 4819 }),
      wCell(wTextParagraph('Fdo.:', { bold: true, size: 18, color: '1C463F', spacingAfter: 0 }), { width: 4819 })
    ], { height: 500 })
  ], { width: 9638, indent: 1134 });

  const content = [
    wTextParagraph('2   CONCLUSIONES Y RECOMENDACIONES', { bold: true, size: 28, color: '123D34', indentLeft: 1134, spacingAfter: 360 }),
    wTextParagraph(conclusion, { size: 20, color: '1C463F', indentLeft: 1134, indentRight: 1134, spacingAfter: 700 }),
    signatureTable,
    wTextParagraph(formatLongSpanishDate(), { align: 'center', italic: true, bold: true, size: 21, color: '1C463F', spacingBefore: 560 })
  ].join('');
  return buildDocxPage(content, pageNumber, totalPages, hasLogoDark);
}

function buildDocxAnnex(pageNumber, totalPages, hasLogoDark) {
  const content = [
    wTextParagraph('3   ANEXO', { bold: true, size: 28, color: '123D34', indentLeft: 1134, spacingAfter: 360 }),
    wTextParagraph('Sin anexos adicionales.', { size: 20, color: '1C463F', indentLeft: 1134, indentRight: 1134, spacingAfter: 0 })
  ].join('');
  return buildDocxPage(content, pageNumber, totalPages, hasLogoDark);
}

function buildDocxDocumentXml(hasLogo, hasLogoDark) {
  readGeneralForm();
  wImageRun.nextId = 1;
  const chunks = [];
  for (let index = 0; index < state.elements.length; index += VOLTIA_ROWS_PER_PAGE) {
    chunks.push(state.elements.slice(index, index + VOLTIA_ROWS_PER_PAGE));
  }
  if (!chunks.length) chunks.push([]);

  const conclusionPageNumber = 3 + chunks.length;
  const annexPageNumber = conclusionPageNumber + 1;
  const totalPages = annexPageNumber;
  const pages = [
    buildDocxCover(hasLogo),
    buildDocxToc(conclusionPageNumber, annexPageNumber, totalPages, hasLogoDark),
    ...chunks.map((chunk, index) => buildDocxElementsPage(chunk, 3 + index, index === 0, totalPages, hasLogoDark)),
    buildDocxConclusion(conclusionPageNumber, totalPages, hasLogoDark),
    buildDocxAnnex(annexPageNumber, totalPages, hasLogoDark)
  ];

  const body = pages.map((page, index) => page + (index < pages.length - 1 ? wPageBreak() : '')).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="0" w:right="0" w:bottom="0" w:left="0" w:header="0" w:footer="0" w:gutter="0"/></w:sectPr></w:body></w:document>`;
}

function buildDocxBlob() {
  const logoBytes = getReportLogoBytes('img.logo');
  const darkLogoBytes = getReportLogoBytes('img.logo-cab');
  const files = [
    { name: '[Content_Types].xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/></Types>` },
    { name: '_rels/.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>` },
    { name: 'word/document.xml', data: buildDocxDocumentXml(Boolean(logoBytes), Boolean(darkLogoBytes)) },
    { name: 'word/styles.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Lato" w:hAnsi="Lato" w:eastAsia="Arial" w:cs="Arial"/><w:sz w:val="20"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120"/></w:pPr></w:pPrDefault></w:docDefaults></w:styles>` },
    { name: 'word/settings.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:zoom w:percent="100"/><w:defaultTabStop w:val="708"/><w:doNotHyphenateCaps/></w:settings>` },
    { name: 'word/_rels/document.xml.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${logoBytes ? '<Relationship Id="rIdLogo" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/logo.png"/>' : ''}${darkLogoBytes ? '<Relationship Id="rIdLogoDark" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/logo-dark.png"/>' : ''}</Relationships>` }
  ];
  if (logoBytes) files.push({ name: 'word/media/logo.png', data: logoBytes });
  if (darkLogoBytes) files.push({ name: 'word/media/logo-dark.png', data: darkLogoBytes });
  return new Blob([createZip(files)], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
}

async function downloadDoc() {
  if (!ensureReportReady()) return;
  const filename = `${safeFilename(state.general.numeroInforme)}.docx`;
  try {
    setExportBusy(true, 'Preparando Word con la plantilla original...');
    const pageImages = await rasterizeReportPages(state.reportHtml);
    const blob = buildImageDocxBlob(pageImages);
    downloadBlob(blob, filename);
  } catch (error) {
    console.warn('No se pudo crear el Word visual; se intenta una versión editable simplificada.', error);
    try {
      setExportBusy(true, 'Preparando Word editable simplificado...');
      const blob = buildDocxBlob();
      downloadBlob(blob, filename);
    } catch (fallbackError) {
      console.error(fallbackError);
      window.alert(`No se pudo crear el Word: ${fallbackError.message}`);
    }
  } finally {
    setExportBusy(false);
    dom.downloadDoc.disabled = false;
    dom.printReport.disabled = false;
    dom.downloadHtml.disabled = false;
  }
}

async function printReport() {
  if (!ensureReportReady()) return;
  const filename = `${safeFilename(state.general.numeroInforme)}.pdf`;
  try {
    setExportBusy(true, 'Preparando PDF fiel a la plantilla...');
    const pageImages = await rasterizeReportPages(state.reportHtml);
    const blob = createPdfFromPageImages(pageImages);
    downloadBlob(blob, filename);
  } catch (error) {
    console.error(error);
    window.alert(`No se pudo crear el PDF fiel: ${error.message} Se abrirá la impresión clásica como alternativa.`);
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;
    printWindow.document.open();
    printWindow.document.write(prepareHtmlForPrint(state.reportHtml));
    printWindow.document.close();
    printWindow.addEventListener('load', () => printWindow.print(), { once: true });
  } finally {
    setExportBusy(false);
    dom.downloadDoc.disabled = false;
    dom.printReport.disabled = false;
    dom.downloadHtml.disabled = false;
  }
}

function resetApp() {
  const ok = window.confirm('Esto borrará todos los datos del informe actual. ¿Continuar?');
  if (!ok) return;
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem('informeTecnicoDraft.v1');
  state.general = { cliente: '', emplazamiento: '', instalacion: '', numeroInforme: '' };
  state.elements = [];
  state.currentInkDataUrl = '';
  state.currentInkText = '';
  state.currentInputMethod = 'manual';
  state.reportHtml = '';
  dom.generalForm.reset();
  clearElementForm();
  renderElementsTable();
  dom.reportPreview.innerHTML = '';
  dom.reportPreview.classList.add('hidden');
  dom.reportPreview.classList.remove('voltia-ready');
  dom.validationSummary.classList.add('hidden');
  dom.downloadHtml.disabled = true;
  dom.downloadDoc.disabled = true;
  dom.printReport.disabled = true;
  setSaveStatus('Datos borrados');
}

function supportsSpeechRecognition() {
  return 'SpeechRecognition' in window || 'webkitSpeechRecognition' in window;
}

function isLocalOrSecureContext() {
  const hostname = window.location.hostname;
  return window.isSecureContext || ['localhost', '127.0.0.1', '::1', ''].includes(hostname);
}

function explainMicrophoneError(error) {
  const name = error?.name || error?.error || '';
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError' || name === 'not-allowed' || name === 'service-not-allowed') {
    return 'El permiso de micrófono está bloqueado. Pulsa el candado de la barra de direcciones, permite el micrófono para esta página y recarga la aplicación.';
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError' || name === 'audio-capture') {
    return 'No se ha encontrado ningún micrófono disponible. Conecta o habilita un micrófono y vuelve a intentarlo.';
  }
  if (name === 'NotReadableError' || name === 'TrackStartError') {
    return 'El micrófono está ocupado por otra aplicación o el sistema no deja acceder a él. Cierra otras aplicaciones de audio y vuelve a intentarlo.';
  }
  if (name === 'SecurityError') {
    return 'El navegador ha bloqueado el acceso al micrófono por seguridad. Usa HTTPS o abre la app desde http://localhost.';
  }
  if (name === 'network') {
    return 'El servicio de reconocimiento de voz del navegador no está disponible ahora. Revisa la conexión o prueba en Chrome/Edge.';
  }
  if (name === 'no-speech') {
    return 'No se ha detectado voz. Acerca el micrófono, habla más alto y vuelve a intentarlo.';
  }
  if (name === 'aborted') {
    return 'El dictado se ha detenido antes de terminar.';
  }
  return 'No se ha podido captar el audio. Revisa el permiso del micrófono y prueba en Chrome/Edge.';
}

async function queryMicrophonePermission() {
  if (!navigator.permissions?.query) return 'unknown';
  try {
    const status = await navigator.permissions.query({ name: 'microphone' });
    state.speech.permissionState = status.state;
    status.onchange = () => {
      state.speech.permissionState = status.state;
      updateVoiceButtonsAvailability();
    };
    return status.state;
  } catch {
    return 'unknown';
  }
}

async function ensureMicrophonePermission() {
  if (!isLocalOrSecureContext()) {
    throw new Error('El micrófono solo funciona en un contexto seguro. Publica la app por HTTPS o pruébala desde http://localhost en lugar de abrir el HTML como una página no segura.');
  }

  const permission = await queryMicrophonePermission();
  if (permission === 'denied') {
    throw new Error('El permiso de micrófono está denegado para esta página. Cámbialo a “Permitir” en los ajustes del sitio y recarga.');
  }

  if (!navigator.mediaDevices?.getUserMedia) {
    // Algunos navegadores delegan el permiso directamente en SpeechRecognition.
    return true;
  }

  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }
    });
    state.speech.permissionState = 'granted';
    return true;
  } catch (error) {
    throw new Error(explainMicrophoneError(error));
  } finally {
    if (stream) stream.getTracks().forEach(track => track.stop());
    updateVoiceButtonsAvailability();
  }
}

function setDictationButtonState(button, listening) {
  button.classList.toggle('listening', listening);
  button.setAttribute('aria-pressed', listening ? 'true' : 'false');
  button.textContent = listening ? '🔴' : '🎙️';
  dom.voiceElemento.disabled = listening && button !== dom.voiceElemento;
  dom.voiceObservaciones.disabled = listening && button !== dom.voiceObservaciones;
}

function stopActiveDictation() {
  if (state.speech.activeRecognition) {
    try { state.speech.activeRecognition.abort(); } catch { /* sin acción */ }
  }
}

async function startDictation(target, button, append = false) {
  if (!supportsSpeechRecognition()) {
    window.alert('El dictado por voz no está disponible en este navegador. Usa Chrome o Edge y concede permiso de micrófono.');
    return;
  }

  if (state.speech.activeRecognition) {
    stopActiveDictation();
    if (state.speech.activeButton === button) return;
  }

  try {
    await ensureMicrophonePermission();
  } catch (error) {
    const message = error?.message || explainMicrophoneError(error);
    setSaveStatus('Micrófono bloqueado', 'error');
    window.alert(message);
    return;
  }

  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const recognition = new Recognition();
  recognition.lang = 'es-ES';
  recognition.interimResults = true;
  recognition.continuous = false;
  recognition.maxAlternatives = 1;

  let finalTranscript = '';
  const baseValue = target.value.trim();
  state.speech.activeRecognition = recognition;
  state.speech.activeButton = button;
  setDictationButtonState(button, true);
  setSaveStatus('Escuchando dictado...', 'ok');

  recognition.onresult = (event) => {
    const pieces = Array.from(event.results)
      .map(result => result[0]?.transcript || '')
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (!pieces) return;
    finalTranscript = pieces;
    const nextValue = append && baseValue
      ? `${baseValue} ${pieces}`
      : pieces;
    target.value = nextValue.trim();
    if (target === dom.elemento) state.currentInputMethod = 'voice';
    target.dispatchEvent(new Event('input', { bubbles: true }));
  };

  recognition.onerror = (event) => {
    const message = explainMicrophoneError(event);
    setSaveStatus('Error de dictado', 'error');
    if (event.error !== 'aborted') window.alert(message);
  };

  recognition.onend = () => {
    setDictationButtonState(button, false);
    dom.voiceElemento.disabled = false;
    dom.voiceObservaciones.disabled = false;
    state.speech.activeRecognition = null;
    state.speech.activeButton = null;
    setSaveStatus(finalTranscript ? 'Dictado añadido' : 'Dictado detenido', finalTranscript ? 'ok' : 'warning');
  };

  try {
    recognition.start();
  } catch (error) {
    setDictationButtonState(button, false);
    state.speech.activeRecognition = null;
    state.speech.activeButton = null;
    window.alert(explainMicrophoneError(error));
  }
}

async function updateVoiceButtonsAvailability() {
  const speechAvailable = supportsSpeechRecognition();
  const permission = await queryMicrophonePermission();
  const blocked = permission === 'denied';
  const insecure = !isLocalOrSecureContext();
  const disabled = !speechAvailable || blocked || insecure;
  [dom.voiceElemento, dom.voiceObservaciones].forEach((button) => {
    button.disabled = disabled;
    if (!speechAvailable) button.title = 'Dictado no disponible en este navegador. Usa Chrome o Edge.';
    else if (blocked) button.title = 'Permiso de micrófono bloqueado. Permítelo en los ajustes del sitio.';
    else if (insecure) button.title = 'El micrófono requiere HTTPS o localhost.';
    else button.title = 'Dictar con micrófono';
  });
}

function setInkStatus(message, type = 'info') {
  dom.inkStatus.textContent = message;
  dom.inkStatus.dataset.type = type;
}

function openInkDialog() {
  if (dom.inkDialog.open) return;
  if (typeof dom.inkDialog.showModal === 'function') {
    dom.inkDialog.showModal();
  } else {
    dom.inkDialog.setAttribute('open', '');
  }
}

function closeInkDialog() {
  if (!dom.inkDialog.open) return;
  if (typeof dom.inkDialog.close === 'function') {
    dom.inkDialog.close();
  } else {
    dom.inkDialog.removeAttribute('open');
  }
}

function renderInkCandidates(candidates) {
  if (!candidates.length) {
    dom.inkCandidates.innerHTML = '<span class="muted-inline">Sin opciones todavía.</span>';
    return;
  }

  dom.inkCandidates.innerHTML = candidates.map((candidate, index) => `
    <button type="button" class="candidate-button" data-candidate-index="${index}">
      <span>${escapeHtml(candidate.text)}</span>
      <small>${escapeHtml(candidate.source || '')}</small>
    </button>
  `).join('');

  dom.inkCandidates.querySelectorAll('button[data-candidate-index]').forEach((button) => {
    button.addEventListener('click', () => {
      const candidate = candidates[Number(button.dataset.candidateIndex)];
      dom.inkTranscription.value = candidate.text;
      setInkStatus(`Seleccionado: ${candidate.text}`, 'ok');
    });
  });
}

function updateCandidatesFromText(text, source = 'Lectura') {
  const suggestions = getBestSuggestions(text, 8)
    .map(item => ({ ...item, source: item.source === 'Lectura directa' ? source : item.source }));
  const candidates = mergeCandidates([{ text, score: 100, source }], suggestions);
  state.handwriting.lastPredictions = candidates;
  renderInkCandidates(candidates);
  if (candidates[0]) dom.inkTranscription.value = candidates[0].text;
  return candidates;
}

function getHandwritingGraphemeSet() {
  return [...new Set(
    SUGERENCIAS_ELEMENTOS
      .join(' ')
      .toLowerCase()
      .split('')
      .filter(char => char.trim())
  )].slice(0, 120);
}

async function createNativeHandwritingRecognizer() {
  if (state.handwriting.ready && state.handwriting.recognizer) return state.handwriting.recognizer;

  const canCreateRecognizer = typeof navigator.createHandwritingRecognizer === 'function';
  const StrokeCtor = window.HandwritingStroke;
  if (!canCreateRecognizer || typeof StrokeCtor !== 'function') {
    state.handwriting.supported = false;
    return null;
  }

  const querySupport = navigator.queryHandwritingRecognizerSupport || navigator.queryHandwritingRecognizer;
  const constraintCandidates = [
    { languages: ['es-ES'] },
    { languages: ['es'] },
    { languages: ['en-US'] },
    { languages: ['en'] }
  ];

  for (const constraints of constraintCandidates) {
    try {
      if (typeof querySupport === 'function') {
        const support = await querySupport.call(navigator, constraints);
        if (!support || support.text === false) continue;
      }

      const recognizer = await navigator.createHandwritingRecognizer(constraints);
      state.handwriting.supported = true;
      state.handwriting.ready = true;
      state.handwriting.recognizer = recognizer;
      return recognizer;
    } catch {
      // Probamos otro idioma o pasamos al OCR/fallback asistido.
    }
  }

  state.handwriting.supported = false;
  return null;
}

function getCanvasPoint(event) {
  const canvas = dom.inkCanvas;
  const rect = canvas.getBoundingClientRect();
  return {
    x: (event.clientX - rect.left) * (canvas.width / rect.width),
    y: (event.clientY - rect.top) * (canvas.height / rect.height)
  };
}

function getHandwritingInputType(pointerType = '') {
  if (pointerType === 'touch') return 'touch';
  if (pointerType === 'mouse') return 'mouse';
  if (pointerType === 'pen' || pointerType === 'stylus') return 'stylus';
  return 'stylus';
}

function addNativePoint(event) {
  if (!state.handwriting.activeStroke) return;
  const point = getCanvasPoint(event);
  const timeElapsed = Date.now() - state.handwriting.activeStrokeStart;
  try {
    state.handwriting.activeStroke.addPoint({ x: point.x, y: point.y, t: timeElapsed });
  } catch {
    // Si el motor nativo rechaza un punto aislado, el trazo visual sigue siendo válido.
  }
}

function resetNativeDrawing() {
  if (state.handwriting.drawing?.clear) {
    try { state.handwriting.drawing.clear(); } catch { /* sin acción */ }
  }
  state.handwriting.drawing = null;
  state.handwriting.activeStroke = null;
  state.handwriting.activeStrokeStart = 0;
  state.handwriting.lastPredictions = [];
}

function startNativeStroke(event) {
  if (!state.handwriting.recognizer || typeof window.HandwritingStroke !== 'function') return;

  if (!state.handwriting.drawing) {
    state.handwriting.lastPointerType = getHandwritingInputType(event.pointerType);
    const hints = {
      recognitionType: 'text',
      inputType: state.handwriting.lastPointerType,
      alternatives: 8,
      textContext: SUGERENCIAS_ELEMENTOS.join(', '),
      graphemeSet: getHandwritingGraphemeSet()
    };

    try {
      state.handwriting.drawing = state.handwriting.recognizer.startDrawing(hints);
    } catch {
      try {
        delete hints.graphemeSet;
        state.handwriting.drawing = state.handwriting.recognizer.startDrawing(hints);
      } catch {
        state.handwriting.drawing = null;
        return;
      }
    }
  }

  state.handwriting.activeStroke = new HandwritingStroke();
  state.handwriting.activeStrokeStart = Date.now();
  addNativePoint(event);
}

async function finishNativeStroke() {
  if (!state.handwriting.drawing || !state.handwriting.activeStroke) return;

  try {
    state.handwriting.drawing.addStroke(state.handwriting.activeStroke);
    state.handwriting.activeStroke = null;
    await recognizeCurrentInk({ automatic: true });
  } catch {
    state.handwriting.activeStroke = null;
  }
}

function extractNativePredictions(predictions = []) {
  return predictions
    .map((prediction, index) => ({
      text: prediction?.text || prediction?.label || '',
      score: Number(prediction?.score ?? prediction?.confidence ?? (100 - index * 8)),
      source: index === 0 ? 'Lectura manuscrita nativa' : 'Alternativa nativa'
    }))
    .filter(item => item.text.trim());
}

function loadScriptOnce(src, id) {
  const existing = document.getElementById(id);
  if (existing) {
    return existing.dataset.loaded === 'true'
      ? Promise.resolve()
      : new Promise((resolve, reject) => {
          existing.addEventListener('load', resolve, { once: true });
          existing.addEventListener('error', reject, { once: true });
        });
  }

  const script = document.createElement('script');
  script.id = id;
  script.src = src;
  script.async = true;
  script.onload = () => { script.dataset.loaded = 'true'; };
  document.head.appendChild(script);
  return new Promise((resolve, reject) => {
    script.addEventListener('load', resolve, { once: true });
    script.addEventListener('error', () => reject(new Error(`No se pudo cargar ${src}`)), { once: true });
  });
}

function cleanOcrText(text = '') {
  return text
    .replace(/[|\\_~^`]+/g, ' ')
    .replace(/[^0-9A-Za-zÁÉÍÓÚÜÑáéíóúüñºª.,;:()\-/\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function getInkBounds(canvas) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const { width, height } = canvas;
  const data = ctx.getImageData(0, 0, width, height).data;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const r = data[offset];
      const g = data[offset + 1];
      const b = data[offset + 2];
      const a = data[offset + 3];
      if (a > 0 && (r < 245 || g < 245 || b < 245)) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
  }

  if (maxX < 0 || maxY < 0) return null;
  const padding = 24;
  return {
    x: Math.max(0, minX - padding),
    y: Math.max(0, minY - padding),
    width: Math.min(width - Math.max(0, minX - padding), maxX - minX + padding * 2),
    height: Math.min(height - Math.max(0, minY - padding), maxY - minY + padding * 2)
  };
}

function prepareInkImageForOcr() {
  const sourceCanvas = dom.inkCanvas;
  const bounds = getInkBounds(sourceCanvas);
  if (!bounds) return null;

  const scale = Math.max(2, Math.min(4, 1200 / Math.max(bounds.width, 1)));
  const targetCanvas = document.createElement('canvas');
  targetCanvas.width = Math.round(bounds.width * scale);
  targetCanvas.height = Math.round(bounds.height * scale);
  const ctx = targetCanvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, targetCanvas.width, targetCanvas.height);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(
    sourceCanvas,
    bounds.x,
    bounds.y,
    bounds.width,
    bounds.height,
    0,
    0,
    targetCanvas.width,
    targetCanvas.height
  );
  return targetCanvas.toDataURL('image/png');
}

async function recognizeWithTesseractOcr() {
  const config = window.INFORMES_CONFIG || {};
  if (config.enableTesseractFallback === false) return [];

  const imageDataUrl = prepareInkImageForOcr();
  if (!imageDataUrl) return [];

  const tesseractUrl = config.tesseractCdn || 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
  if (!window.Tesseract?.recognize) {
    state.handwriting.ocrScriptPromise ||= loadScriptOnce(tesseractUrl, 'tesseract-js-cdn');
    await state.handwriting.ocrScriptPromise;
  }

  if (!window.Tesseract?.recognize) return [];

  const recognize = async (language) => window.Tesseract.recognize(imageDataUrl, language, {
    logger: (message) => {
      if (message.status === 'recognizing text' && typeof message.progress === 'number') {
        const pct = Math.round(message.progress * 100);
        setInkStatus(`OCR en navegador: ${pct}%`, 'info');
      }
    }
  });

  let result;
  try {
    result = await recognize('spa+eng');
  } catch {
    result = await recognize('eng');
  }

  const rawText = cleanOcrText(result?.data?.text || '');
  if (!rawText) return [];

  const confidence = Math.round(Number(result?.data?.confidence ?? 65));
  const lineCandidates = rawText
    .split(/[\n.;]+/)
    .map(cleanOcrText)
    .filter(Boolean)
    .slice(0, 4);

  return mergeCandidates(
    [{ text: rawText, score: confidence, source: 'OCR en navegador' }],
    lineCandidates.map((text, index) => ({ text, score: confidence - index * 6, source: 'OCR en navegador' }))
  );
}

async function recognizeWithExternalOcr() {
  const endpoint = window.INFORMES_CONFIG?.handwritingOcrEndpoint;
  if (!endpoint) return [];

  const imageDataUrl = dom.inkCanvas.toDataURL('image/png');
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      imageDataUrl,
      language: 'es',
      suggestions: SUGERENCIAS_ELEMENTOS
    })
  });

  if (!response.ok) throw new Error('OCR externo no disponible');
  const data = await response.json();
  const texts = Array.isArray(data.candidates) ? data.candidates : [data.text];
  return texts
    .map((item, index) => {
      if (typeof item === 'string') return { text: item, score: 90 - index * 5, source: 'OCR externo' };
      return { text: item.text || '', score: Number(item.score ?? 90 - index * 5), source: item.source || 'OCR externo' };
    })
    .filter(item => item.text.trim());
}

async function recognizeCurrentInk({ automatic = false } = {}) {
  const hasNativeDrawing = Boolean(state.handwriting.drawing);
  const manualSeed = dom.inkTranscription.value.trim();
  const fallbackCandidates = manualSeed ? getBestSuggestions(manualSeed, 8) : [];

  if (!state.handwriting.hasInk && !manualSeed) {
    renderInkCandidates([]);
    setInkStatus('Primero escribe algo en la zona blanca.', 'warning');
    return;
  }

  if (!automatic) {
    setInkStatus('Leyendo escritura...', 'info');
    dom.recognizeInk.disabled = true;
  }

  let nativeCandidates = [];
  if (hasNativeDrawing) {
    try {
      const predictions = await state.handwriting.drawing.getPrediction();
      nativeCandidates = extractNativePredictions(predictions);
    } catch {
      nativeCandidates = [];
    }
  }

  let externalCandidates = [];
  if (!nativeCandidates.length) {
    try {
      externalCandidates = await recognizeWithExternalOcr();
    } catch {
      externalCandidates = [];
    }
  }

  let browserOcrCandidates = [];
  if (!nativeCandidates.length && !externalCandidates.length && !automatic) {
    try {
      state.handwriting.ocrBusy = true;
      browserOcrCandidates = await recognizeWithTesseractOcr();
    } catch {
      browserOcrCandidates = [];
    } finally {
      state.handwriting.ocrBusy = false;
    }
  }

  const readCandidates = mergeCandidates(nativeCandidates, externalCandidates, browserOcrCandidates);
  const assistedCandidates = readCandidates.length
    ? mergeCandidates(
        readCandidates,
        readCandidates.flatMap(candidate => getBestSuggestions(candidate.text, 5))
      )
    : fallbackCandidates;

  renderInkCandidates(assistedCandidates);

  if (assistedCandidates[0]) {
    dom.inkTranscription.value = assistedCandidates[0].text;
    state.handwriting.lastPredictions = assistedCandidates;
    const sources = [
      nativeCandidates.length ? 'lector nativo' : '',
      externalCandidates.length ? 'OCR externo' : '',
      browserOcrCandidates.length ? 'OCR en navegador' : ''
    ].filter(Boolean).join(' + ');
    setInkStatus(sources ? `Texto leído con ${sources}. Revísalo y pulsa “Usar este texto”.` : 'Selecciona una opción o corrige el texto inferior.', sources ? 'ok' : 'warning');
  } else {
    setInkStatus('No se ha podido leer la escritura. Prueba con letra más grande/de imprenta o escribe el texto en el campo inferior.', 'warning');
  }

  dom.recognizeInk.disabled = false;
}

function setupInkCanvas() {
  const canvas = dom.inkCanvas;
  const ctx = canvas.getContext('2d');
  let drawing = false;
  let lastPoint = null;
  let activePointerId = null;

  function resetCanvasDrawingStyle() {
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#111827';
  }

  function clearCanvasSurface() {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    resetCanvasDrawingStyle();
  }

  function resetCanvas() {
    clearCanvasSurface();
    resetNativeDrawing();
    state.handwriting.hasInk = false;
    dom.inkTranscription.value = '';
    renderInkCandidates([]);
    setInkStatus('Escribe una palabra o frase y pulsa “Leer escritura”.', 'info');
    dom.recognizeInk.disabled = false;
  }

  function start(event) {
    event.preventDefault();
    drawing = true;
    state.handwriting.hasInk = true;
    activePointerId = event.pointerId;
    lastPoint = getCanvasPoint(event);
    if (canvas.setPointerCapture) {
      try { canvas.setPointerCapture(event.pointerId); } catch { /* sin acción */ }
    }
    startNativeStroke(event);
  }

  function move(event) {
    if (!drawing || event.pointerId !== activePointerId) return;
    event.preventDefault();
    const point = getCanvasPoint(event);
    ctx.beginPath();
    ctx.moveTo(lastPoint.x, lastPoint.y);
    ctx.lineTo(point.x, point.y);
    ctx.stroke();
    addNativePoint(event);
    lastPoint = point;
  }

  function end(event) {
    if (!drawing || (event?.pointerId && event.pointerId !== activePointerId)) return;
    drawing = false;
    lastPoint = null;
    if (canvas.releasePointerCapture && activePointerId !== null) {
      try { canvas.releasePointerCapture(activePointerId); } catch { /* sin acción */ }
    }
    activePointerId = null;
    finishNativeStroke();
  }

  canvas.addEventListener('pointerdown', start);
  canvas.addEventListener('pointermove', move);
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  canvas.addEventListener('lostpointercapture', end);

  dom.clearInk.addEventListener('click', resetCanvas);
  dom.recognizeInk.addEventListener('click', () => recognizeCurrentInk({ automatic: false }));

  dom.inkTranscription.addEventListener('input', () => {
    const value = dom.inkTranscription.value.trim();
    if (value) updateCandidatesFromText(value, 'Texto escrito');
    else renderInkCandidates([]);
  });

  dom.saveInk.addEventListener('click', () => {
    const transcription = dom.inkTranscription.value.trim();
    if (!transcription) {
      setInkStatus('Antes de continuar, selecciona o escribe el texto que se guardará.', 'warning');
      dom.inkTranscription.focus();
      return;
    }

    state.currentInkDataUrl = canvas.toDataURL('image/png');
    state.currentInkText = transcription;
    state.currentInputMethod = 'ink';
    dom.elemento.value = transcription;
    dom.elemento.dispatchEvent(new Event('input', { bubbles: true }));
    dom.elementoInkPreview.innerHTML = `<strong>Texto leído de escritura:</strong> ${escapeHtml(transcription)}<img src="${state.currentInkDataUrl}" alt="Trazo manuscrito guardado" />`;
    dom.elementoInkPreview.classList.remove('hidden');
    closeInkDialog();
    dom.elemento.focus();
    updateDatalist();
  });

  dom.inkElemento.addEventListener('click', async () => {
    const initialText = dom.elemento.value.trim();
    openInkDialog();
    requestAnimationFrame(() => {
      resetCanvas();
      dom.inkTranscription.value = initialText;
      if (initialText) updateCandidatesFromText(initialText, 'Texto existente');
    });

    const recognizer = await createNativeHandwritingRecognizer();
    if (recognizer) {
      setInkStatus('Lector manuscrito nativo disponible. Escribe con lápiz, dedo o ratón; la lectura aparecerá abajo.', 'ok');
    } else if (window.INFORMES_CONFIG?.handwritingOcrEndpoint) {
      setInkStatus('Se usará el OCR configurado en el servidor al pulsar “Leer escritura”.', 'info');
    } else if (window.INFORMES_CONFIG?.enableTesseractFallback !== false) {
      setInkStatus('Este navegador no ofrece lector manuscrito nativo. Al pulsar “Leer escritura” se intentará OCR en navegador; funciona mejor con letra grande/de imprenta.', 'warning');
    } else {
      setInkStatus('Este navegador no reconoce manuscrita automáticamente: escribe o selecciona el texto inferior.', 'warning');
    }
  });

  resetCanvas();
}

function wireEvents() {
  const autoSave = debounce(saveDraft, 450);
  [dom.cliente, dom.emplazamiento, dom.instalacion, dom.numeroInforme].forEach(input => {
    input.addEventListener('input', autoSave);
  });

  dom.elemento.addEventListener('input', () => {
    state.currentInputMethod = state.currentInputMethod === 'ink' ? 'ink' : 'manual';
    updateDatalist();
  });
  dom.elementForm.addEventListener('submit', addOrUpdateElement);
  dom.clearElementForm.addEventListener('click', clearElementForm);

  dom.tableBody.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-action]');
    if (!button) return;
    const index = Number(button.dataset.index);
    if (button.dataset.action === 'edit') editElement(index);
    if (button.dataset.action === 'delete') deleteElement(index);
  });

  dom.voiceElemento.addEventListener('click', () => startDictation(dom.elemento, dom.voiceElemento, false));
  dom.voiceObservaciones.addEventListener('click', () => startDictation(dom.observaciones, dom.voiceObservaciones, true));

  dom.generateReport.addEventListener('click', generateReport);
  dom.downloadHtml.addEventListener('click', downloadHtml);
  dom.downloadDoc.addEventListener('click', downloadDoc);
  dom.printReport.addEventListener('click', printReport);
  dom.resetApp.addEventListener('click', resetApp);

  window.addEventListener('beforeunload', saveDraft);
}

function init() {
  updateDatalist();
  loadDraft();
  renderElementsTable();
  setupInkCanvas();
  wireEvents();

  updateVoiceButtonsAvailability();

  createNativeHandwritingRecognizer().then((recognizer) => {
    if (recognizer) {
      dom.inkElemento.title = 'Escribir con lápiz y convertir a texto';
    } else {
      dom.inkElemento.title = 'Escribir con lápiz; lectura automática según compatibilidad del navegador o OCR configurado';
      setSaveStatus('Lector manuscrito limitado en este navegador', 'warning');
    }
  });
}

document.addEventListener('DOMContentLoaded', init);
