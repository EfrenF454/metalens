'use strict';

const $ = (id) => document.getElementById(id);

const dropzone = $('dropzone');
const fileInput = $('file-input');
const folderInput = $('folder-input');
const folderBtn = $('folder-btn');
const loadingEl = $('loading');
const errorEl = $('error');
const resultsEl = $('results');
const dzWarningEl = $('dz-warning');
const folderListEl = $('folder-list');
const folderListItemsEl = $('folder-list-items');
const folderListEmptyEl = $('folder-list-empty');

const FOLDER_ACCEPTED_EXT = /\.(jpe?g|png|gif|bmp|tiff?|webp|heic|heif|raw|cr2|cr3|nef|arw|dng|orf|rw2|mp4|mov|avi|mkv|m4v|3gp|webm)$/i;

let lastResult = null;
let lastFileName = 'metadata';
let lastSummaryRows = [];
let previewURL = null;
let folderFiles = [];

const baseName = () => lastFileName.replace(/\.[^.]+$/, '');

function downloadBlob(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

// ---------- Navegación entre estados ----------
function show(state) {
  dropzone.hidden = state !== 'drop';
  loadingEl.hidden = state !== 'loading';
  errorEl.hidden = state !== 'error';
  resultsEl.hidden = state !== 'results';
  folderListEl.hidden = state !== 'folder-list';
  dzWarningEl.hidden = state !== 'drop';
}

function showError(message) {
  $('error-text').textContent = message;
  show('error');
}

// ---------- Subida ----------
dropzone.addEventListener('click', () => fileInput.click());
dropzone.addEventListener('keydown', (e) => {
  if (e.target !== dropzone) return;
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    fileInput.click();
  }
});
fileInput.addEventListener('change', () => {
  if (fileInput.files.length) handleFile(fileInput.files[0]);
});

// ---------- Selección de carpeta (conserva GPS al evitar la galería de Android) ----------
folderBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  folderInput.click();
});
folderInput.addEventListener('change', () => {
  if (folderInput.files.length) handleFolderSelection(folderInput.files);
});
folderListItemsEl.addEventListener('click', (e) => {
  const btn = e.target.closest('.folder-item');
  if (!btn) return;
  handleFile(folderFiles[Number(btn.dataset.idx)]);
});
$('folder-list-back').addEventListener('click', () => {
  folderInput.value = '';
  show('drop');
});

function handleFolderSelection(fileList) {
  const files = Array.from(fileList).filter((f) => FOLDER_ACCEPTED_EXT.test(f.name));

  if (!files.length) {
    folderFiles = [];
    folderListItemsEl.innerHTML = '';
    folderListEmptyEl.hidden = false;
    return show('folder-list');
  }
  if (files.length === 1) {
    return handleFile(files[0]);
  }

  files.sort((a, b) => b.lastModified - a.lastModified);
  folderFiles = files;
  folderListEmptyEl.hidden = true;
  folderListItemsEl.innerHTML = files.map((f, i) => `
    <li><button type="button" class="folder-item" data-idx="${i}">
      <span class="folder-item-name">${esc(f.name)}</span>
      <span class="folder-item-meta mono">${fmtBytes(f.size)} · ${esc(new Date(f.lastModified).toLocaleString('es-MX'))}</span>
    </button></li>`).join('');
  show('folder-list');
}

['dragenter', 'dragover'].forEach((ev) =>
  dropzone.addEventListener(ev, (e) => {
    e.preventDefault();
    dropzone.classList.add('dragover');
  })
);
['dragleave', 'drop'].forEach((ev) =>
  dropzone.addEventListener(ev, (e) => {
    e.preventDefault();
    dropzone.classList.remove('dragover');
  })
);
dropzone.addEventListener('drop', (e) => {
  const file = e.dataTransfer?.files?.[0];
  if (file) handleFile(file);
});

$('error-retry').addEventListener('click', () => show('drop'));
$('btn-new').addEventListener('click', () => {
  fileInput.value = '';
  folderInput.value = '';
  show('drop');
});
$('btn-json').addEventListener('click', () => {
  if (!lastResult) return;
  downloadBlob(
    new Blob([JSON.stringify(lastResult, null, 2)], { type: 'application/json' }),
    `${baseName()}-metadata.json`
  );
});

// CSV con todos los tags: Grupo, Tag, Valor (BOM para que Excel respete los acentos)
$('btn-csv').addEventListener('click', () => {
  if (!lastResult) return;
  const q = (s) => `"${String(s).replace(/"/g, '""')}"`;
  const lines = ['Grupo,Tag,Valor'];
  for (const [group, tags] of Object.entries(lastResult.groups)) {
    for (const [tag, val] of Object.entries(tags)) {
      const str = typeof val === 'object' ? JSON.stringify(val) : String(val);
      lines.push([q(group), q(tag), q(str)].join(','));
    }
  }
  downloadBlob(
    new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' }),
    `${baseName()}-metadata.csv`
  );
});

// Excel con la tabla de resumen (las tarjetas de la vista)
$('btn-xlsx').addEventListener('click', () => {
  if (!lastSummaryRows.length) return;
  const ws = XLSX.utils.aoa_to_sheet([['Campo', 'Valor'], ...lastSummaryRows]);
  ws['!cols'] = [
    { wch: Math.max(...lastSummaryRows.map((r) => r[0].length), 5) + 2 },
    { wch: Math.min(Math.max(...lastSummaryRows.map((r) => String(r[1]).length), 5) + 2, 80) },
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Resumen');
  XLSX.writeFile(wb, `${baseName()}-resumen.xlsx`);
});

async function handleFile(file) {
  if (file.size > 1024 * 1024 * 1024) {
    return showError('El archivo supera el límite de 1 GB.');
  }
  show('loading');
  $('loading-text').textContent = `Extrayendo metadatos de ${file.name}…`;

  const body = new FormData();
  body.append('file', file);

  try {
    const res = await fetch('/api/extract', { method: 'POST', body });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data) {
      return showError(data?.error || `Error del servidor (HTTP ${res.status}).`);
    }
    lastResult = data;
    lastFileName = file.name;
    render(data, file);
    show('results');
  } catch {
    showError('No se pudo conectar con el servidor. ¿Está corriendo `npm start`?');
  }
}

// ---------- Render ----------
const fmtBytes = (b) => {
  if (b == null) return '—';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  while (b >= 1024 && i < units.length - 1) { b /= 1024; i++; }
  return `${b.toFixed(i ? 1 : 0)} ${units[i]}`;
};

const fmtDuration = (s) => {
  if (s == null) return null;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = (s % 60).toFixed(1);
  return h ? `${h}h ${m}m ${sec}s` : m ? `${m}m ${sec}s` : `${sec}s`;
};

const ICONS = {
  camera: '<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>',
  film: '<rect x="2" y="2" width="20" height="20" rx="2.18"/><line x1="7" y1="2" x2="7" y2="22"/><line x1="17" y1="2" x2="17" y2="22"/><line x1="2" y1="12" x2="22" y2="12"/>',
  aperture: '<circle cx="12" cy="12" r="10"/><line x1="14.31" y1="8" x2="20.05" y2="17.94"/><line x1="9.69" y1="8" x2="21.17" y2="8"/><line x1="7.38" y1="12" x2="13.12" y2="2.06"/><line x1="9.69" y1="16" x2="3.95" y2="6.06"/><line x1="14.31" y1="16" x2="2.83" y2="16"/><line x1="16.62" y1="12" x2="10.88" y2="21.94"/>',
  volume: '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>',
  cpu: '<rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><line x1="9" y1="1" x2="9" y2="4"/><line x1="15" y1="1" x2="15" y2="4"/><line x1="9" y1="20" x2="9" y2="23"/><line x1="15" y1="20" x2="15" y2="23"/><line x1="20" y1="9" x2="23" y2="9"/><line x1="20" y1="14" x2="23" y2="14"/><line x1="1" y1="9" x2="4" y2="9"/><line x1="1" y1="14" x2="4" y2="14"/>',
  device: '<rect x="5" y="2" width="14" height="20" rx="2"/><line x1="12" y1="18" x2="12.01" y2="18"/>',
  clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
  drive: '<line x1="22" y1="12" x2="2" y2="12"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/><line x1="6" y1="16" x2="6.01" y2="16"/><line x1="10" y1="16" x2="10.01" y2="16"/>',
  pin: '<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>',
};

function stat(label, value, icon) {
  if (value == null || value === '') return '';
  return `<div class="stat">
    <div class="label"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[icon] || ICONS.cpu}</svg>${esc(label)}</div>
    <div class="value">${esc(String(value))}</div>
  </div>`;
}

const esc = (s) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function render(data, file) {
  const s = data.summary;

  // Vista previa local (el archivo nunca vuelve del servidor)
  if (previewURL) URL.revokeObjectURL(previewURL);
  previewURL = URL.createObjectURL(file);
  const preview = $('preview');
  if (file.type.startsWith('image/')) {
    preview.innerHTML = `<img src="${previewURL}" alt="Vista previa de ${esc(file.name)}" />`;
  } else if (file.type.startsWith('video/')) {
    preview.innerHTML = `<video src="${previewURL}" controls muted preload="metadata" aria-label="Vista previa de ${esc(file.name)}"></video>`;
  } else {
    preview.innerHTML = `<p class="no-preview">Sin vista previa disponible para este formato</p>`;
  }

  $('file-name').textContent = s.fileName;
  $('file-info').textContent = [s.fileType || s.mimeType, fmtBytes(s.fileSize),
    s.width && s.height ? `${s.width}×${s.height}px` : null].filter(Boolean).join(' · ');

  // Tarjetas de resumen: una sola fuente de datos para las cards y el Excel
  const v = s.video;
  const geo = s.gps ? `${s.gps.latitude}, ${s.gps.longitude}` : null;
  const cards = [
    ['Dispositivo', [s.make, s.model].filter(Boolean).join(' '), 'device'],
    ['Sistema', s.software, 'cpu'],
    ['Fecha de grabación/captura', s.createDate, 'calendar'],
    ['Zona horaria', s.timezone, 'clock'],
    ['Duración', v ? fmtDuration(v.duration) : null, 'film'],
    ['Formato', [s.fileType, s.mimeType].filter(Boolean).join(' · '), 'file'],
    ['Tamaño', fmtBytes(s.fileSize), 'drive'],
    ['Resolución', s.width && s.height ? `${s.width} × ${s.height} px` : null, 'image'],
    ['Geolocalización', geo, 'pin'],
    ['Objetivo', s.lens, 'camera'],
    ['Exposición', [s.shutter, s.aperture, s.iso ? `ISO ${s.iso}` : null].filter(Boolean).join(' · '), 'aperture'],
    ['Distancia focal', s.focalLength, 'aperture'],
    ['Video', v ? [v.videoCodec, v.frameRate ? `${v.frameRate} fps` : null].filter(Boolean).join(' · ') : null, 'film'],
    ['Bitrate', v?.bitRate ? `${(v.bitRate / 1e6).toFixed(2)} Mb/s` : null, 'film'],
    ['Audio', v?.audioCodec ? `${v.audioCodec}${v.audioChannels ? ` · ${v.audioChannels} canales` : ''}${v.sampleRate ? ` · ${(v.sampleRate / 1000).toFixed(1)} kHz` : ''}` : null, 'volume'],
    ['Contenedor', v ? v.container : null, 'film'],
  ].filter(([, value]) => value != null && value !== '');

  $('summary-cards').innerHTML = cards.map(([label, value, icon]) => stat(label, value, icon)).join('');

  lastSummaryRows = [
    ['Archivo', s.fileName],
    ...cards.map(([label, value]) => [label, String(value)]),
  ];

  // GPS
  const gpsCard = $('gps-card');
  const gpsLink = $('gps-link');
  gpsCard.hidden = false;
  if (s.gps) {
    const { latitude, longitude, altitude } = s.gps;
    $('gps-coords').textContent =
      `${latitude}, ${longitude}${altitude != null ? ` · ${Math.round(altitude)} m` : ''}`;
    gpsLink.href =
      `https://www.openstreetmap.org/?mlat=${latitude}&mlon=${longitude}#map=16/${latitude}/${longitude}`;
    gpsLink.textContent = 'Ver en el mapa';
    gpsLink.className = 'btn btn-ghost';
    gpsLink.removeAttribute('aria-disabled');
  } else {
    $('gps-coords').textContent = 'Sin datos';
    gpsLink.removeAttribute('href');
    gpsLink.textContent = 'Sin datos';
    gpsLink.className = 'gps-no-data';
    gpsLink.setAttribute('aria-disabled', 'true');
  }

  renderGroups(data.groups);
  $('tag-search').value = '';
}

function renderGroups(groups) {
  const container = $('tag-groups');
  let total = 0;
  container.innerHTML = Object.entries(groups)
    .map(([group, tags]) => {
      const rows = Object.entries(tags)
        .map(([k, val]) => {
          total++;
          const str = typeof val === 'object' ? JSON.stringify(val) : String(val);
          return `<tr data-search="${esc(`${group} ${k} ${str}`.toLowerCase())}">
            <td class="k">${esc(k)}</td><td class="v">${esc(str)}</td>
          </tr>`;
        })
        .join('');
      return `<details class="tag-group" open>
        <summary>${esc(group)} <span class="count">(${Object.keys(tags).length})</span></summary>
        <div class="tag-table-wrap"><table class="tag-table"><tbody>${rows}</tbody></table></div>
      </details>`;
    })
    .join('');
  $('tag-count').textContent = `${total} tags`;
}

// ---------- Filtro de búsqueda ----------
let searchTimer;
$('tag-search').addEventListener('input', (e) => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => filterTags(e.target.value.trim().toLowerCase()), 120);
});

function filterTags(query) {
  let anyVisible = false;
  document.querySelectorAll('.tag-group').forEach((group) => {
    let groupVisible = false;
    group.querySelectorAll('tr').forEach((row) => {
      const match = !query || row.dataset.search.includes(query);
      row.hidden = !match;
      if (match) groupVisible = true;
    });
    group.hidden = !groupVisible;
    if (groupVisible && query) group.open = true;
    if (groupVisible) anyVisible = true;
  });
  $('no-match').hidden = anyVisible;
}
