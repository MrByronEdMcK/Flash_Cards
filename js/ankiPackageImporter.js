/**
 * StudyCards Native In-Browser Anki Package (.apkg) Importer
 * 
 * 100% Client-Side WebAssembly & pure JavaScript:
 * - Unpacks .apkg ZIP archive using JSZip
 * - Decompresses modern collection.anki21b via fzstd
 * - Queries Anki database using WebAssembly sql.js
 * - Extracts images and embeds them as base64 data URIs
 * - Converts Anki Image Occlusion Enhanced cards with SVG masks to native StudyCards IO cards
 * - Converts Anki Cloze deletion syntax and HTML tags to native StudyCards Cloze cards
 * 
 * Runs 100% offline, on GitHub Pages, Chromebooks, Mac, and Windows with zero server dependencies.
 */

import { decodeHtmlEntities, convertAnkiHtmlCloze } from './importers.js';

// MIME types lookup
function getMimeType(filename) {
  const ext = (filename || '').toLowerCase().split('.').pop();
  switch (ext) {
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'png':
      return 'image/png';
    case 'gif':
      return 'image/gif';
    case 'webp':
      return 'image/webp';
    case 'svg':
      return 'image/svg+xml';
    default:
      return 'application/octet-stream';
  }
}

// Convert Uint8Array to base64 safely in chunks
function uint8ToBase64(bytes) {
  let binary = '';
  const len = bytes.length;
  const chunkSize = 0x8000;
  for (let i = 0; i < len; i += chunkSize) {
    const sub = bytes.subarray(i, Math.min(i + chunkSize, len));
    binary += String.fromCharCode.apply(null, sub);
  }
  return btoa(binary);
}

// Protobuf varint decoder
function decodeVarint(bytes, pos) {
  let res = 0;
  let shift = 0;
  while (pos < bytes.length) {
    const b = bytes[pos++];
    res |= (b & 0x7f) << shift;
    shift += 7;
    if (!(b & 0x80)) break;
  }
  return [res, pos];
}

// Protobuf media map parser for modern Anki packages
function parseProtobufMediaMap(rawBytes) {
  let pos = 0;
  const fileMap = {};
  let idx = 0;
  const decoder = new TextDecoder('utf-8', { fatal: false });
  while (pos < rawBytes.length) {
    const tag = rawBytes[pos++];
    if (tag !== 0x0a) break;
    const [length, newPos] = decodeVarint(rawBytes, pos);
    pos = newPos;
    const end = pos + length;
    let fn = null;
    while (pos < end && pos < rawBytes.length) {
      const innerTag = rawBytes[pos++];
      const fieldNum = innerTag >> 3;
      const wireType = innerTag & 7;
      if (wireType === 0) {
        const [, np] = decodeVarint(rawBytes, pos);
        pos = np;
      } else if (wireType === 2) {
        const [l, np] = decodeVarint(rawBytes, pos);
        pos = np;
        const valBytes = rawBytes.subarray(pos, pos + l);
        pos += l;
        if (fieldNum === 1) {
          fn = decoder.decode(valBytes);
        }
      } else if (wireType === 5) {
        pos += 4;
      } else if (wireType === 1) {
        pos += 8;
      }
    }
    if (fn) {
      fileMap[fn] = String(idx);
    }
    idx++;
  }
  return fileMap;
}

// Clean HTML formatting while preserving safe elements
function cleanHtml(text) {
  if (!text) return '';
  let str = decodeHtmlEntities(text);
  str = str.replace(/\u00a0/g, ' ');
  // Strip scripts and styles
  str = str.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
  str = str.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');
  // Line breaks
  str = str.replace(/<br\s*\/?>/gi, '\n');
  str = str.replace(/<\/div>/gi, '\n');
  str = str.replace(/<div>/gi, '');
  str = str.replace(/<\/p>/gi, '\n\n');
  str = str.replace(/<p>/gi, '');
  // Spans and wrappers
  str = str.replace(/<span\b[^>]*>/gi, '');
  str = str.replace(/<\/span>/gi, '');
  str = str.replace(/<div\s+id=["']io-(?:header|wrapper|overlay|original|footer)["'][^>]*>/gi, '');
  // Whitespace cleanup
  str = str.replace(/[ \t]+/g, ' ');
  str = str.replace(/\n{3,}/g, '\n\n');
  return str.trim();
}

// Parse SVG mask <rect> elements into percentages (0 - 100)
function parseSvgOcclusionBoxes(svgText) {
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(svgText, 'image/svg+xml');
    const svgEl = doc.querySelector('svg');
    if (!svgEl) return [];

    let svgWidth = parseFloat(svgEl.getAttribute('width')) || 1000;
    let svgHeight = parseFloat(svgEl.getAttribute('height')) || 1000;
    const viewBox = svgEl.getAttribute('viewBox');
    if (viewBox) {
      const parts = viewBox.split(/[\s,]+/).map(Number);
      if (parts.length >= 4 && parts[2] > 0 && parts[3] > 0) {
        svgWidth = parts[2];
        svgHeight = parts[3];
      }
    }
    if (svgWidth <= 0) svgWidth = 1000;
    if (svgHeight <= 0) svgHeight = 1000;

    const rects = doc.querySelectorAll('rect');
    const boxes = [];
    rects.forEach((rect, idx) => {
      const rx = parseFloat(rect.getAttribute('x')) || 0;
      const ry = parseFloat(rect.getAttribute('y')) || 0;
      const rw = parseFloat(rect.getAttribute('width')) || 0;
      const rh = parseFloat(rect.getAttribute('height')) || 0;
      const rid = rect.getAttribute('id') || `box_${idx + 1}`;

      const boxX = Math.round((rx / svgWidth) * 10000) / 100;
      const boxY = Math.round((ry / svgHeight) * 10000) / 100;
      const boxW = Math.round((rw / svgWidth) * 10000) / 100;
      const boxH = Math.round((rh / svgHeight) * 10000) / 100;

      if (boxW > 0 && boxH > 0) {
        boxes.append || boxes.push({
          id: rid,
          x: Math.max(0, Math.min(100, boxX)),
          y: Math.max(0, Math.min(100, boxY)),
          width: Math.max(0.5, Math.min(100, boxW)),
          height: Math.max(0.5, Math.min(100, boxH)),
          label: ''
        });
      }
    });
    return boxes;
  } catch (err) {
    console.warn('Failed to parse SVG mask:', err);
    return [];
  }
}

// Dynamic script loader with cache
function loadScript(src) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${src}"]`);
    if (existing) {
      resolve();
      return;
    }
    const s = document.createElement('script');
    s.src = src;
    s.onload = () => resolve();
    s.onerror = (e) => reject(new Error(`Failed to load script ${src}`));
    document.head.appendChild(s);
  });
}

// Ensure required client-side libraries are ready
export async function ensureAnkiLibraries() {
  const promises = [];
  if (typeof window.JSZip === 'undefined') {
    promises.push(loadScript('js/lib/jszip.min.js'));
  }
  if (typeof window.fzstd === 'undefined') {
    promises.push(loadScript('js/lib/fzstd.min.js'));
  }
  if (typeof window.initSqlJs === 'undefined') {
    promises.push(loadScript('js/lib/sql-wasm.js'));
  }
  await Promise.all(promises);
}

/**
 * Main Native In-Browser .apkg Importer
 * Converts an uploaded Anki package File or ArrayBuffer into StudyCards native JSON
 * 
 * @param {File|Blob|ArrayBuffer} fileInput
 * @param {Function} [onProgress] Callback (message, percent)
 * @returns {Promise<{groups: Array, cards: Array, summary: Object}>}
 */
export async function parseAnkiPackageNative(fileInput, onProgress = null) {
  onProgress?.('Loading package decompression libraries...', 5);
  await ensureAnkiLibraries();

  onProgress?.('Reading .apkg package archive...', 15);
  let arrayBuffer;
  if (fileInput instanceof ArrayBuffer) {
    arrayBuffer = fileInput;
  } else if (fileInput.arrayBuffer) {
    arrayBuffer = await fileInput.arrayBuffer();
  } else {
    throw new Error('Invalid file input for Anki package importer.');
  }

  const zip = await window.JSZip.loadAsync(arrayBuffer);

  // 1. Decompress SQLite database
  onProgress?.('Extracting Anki collection database...', 30);
  let dbBytes;
  if (zip.file('collection.anki21b')) {
    const compBytes = await zip.file('collection.anki21b').async('uint8array');
    if (!window.fzstd || !window.fzstd.decompress) {
      throw new Error('Zstandard decompressor missing for modern Anki 2.1 package.');
    }
    dbBytes = window.fzstd.decompress(compBytes);
  } else if (zip.file('collection.anki2')) {
    dbBytes = await zip.file('collection.anki2').async('uint8array');
  } else if (zip.file('collection.anki21')) {
    dbBytes = await zip.file('collection.anki21').async('uint8array');
  } else {
    throw new Error('Invalid .apkg package: No collection database found.');
  }

  // 2. Parse media mapping
  onProgress?.('Indexing embedded diagrams and media...', 45);
  let mediaMap = {};
  const mediaFile = zip.file('media');
  if (mediaFile) {
    let rawMedia = await mediaFile.async('uint8array');
    // Check if zstd compressed (magic bytes: 0x28 0xB5 0x2F 0xFD)
    if (rawMedia.length >= 4 && rawMedia[0] === 0x28 && rawMedia[1] === 0xb5 && rawMedia[2] === 0x2f && rawMedia[3] === 0xfd) {
      rawMedia = window.fzstd.decompress(rawMedia);
    }
    const decoder = new TextDecoder('utf-8', { fatal: false });
    const textMedia = decoder.decode(rawMedia);
    try {
      const parsedJson = JSON.parse(textMedia);
      // Legacy format maps { "0": "file.png" } -> invert to { "file.png": "0" }
      for (const [k, v] of Object.entries(parsedJson)) {
        mediaMap[v] = k;
      }
    } catch {
      // Protobuf media format in Anki 2.1.50+
      mediaMap = parseProtobufMediaMap(rawMedia);
    }
  }

  // Helper to extract media entry as bytes
  async function getMediaBytes(filename) {
    let entryName = mediaMap[filename];
    let zipEntry = entryName ? zip.file(entryName) : null;
    if (!zipEntry) {
      zipEntry = zip.file(filename);
    }
    if (!zipEntry) return null;

    let bytes = await zipEntry.async('uint8array');
    if (bytes.length >= 4 && bytes[0] === 0x28 && bytes[1] === 0xb5 && bytes[2] === 0x2f && bytes[3] === 0xfd) {
      bytes = window.fzstd.decompress(bytes);
    }
    return bytes;
  }

  // Cache for generated Data URIs
  const dataUriCache = new Map();
  async function getMediaDataUri(filename) {
    if (!filename) return '';
    if (dataUriCache.has(filename)) return dataUriCache.get(filename);

    const bytes = await getMediaBytes(filename);
    if (!bytes) {
      dataUriCache.set(filename, '');
      return '';
    }
    const mime = getMimeType(filename);
    const b64 = uint8ToBase64(bytes);
    const uri = `data:${mime};base64,${b64}`;
    dataUriCache.set(filename, uri);
    return uri;
  }

  async function replaceImgTagsWithDataUri(htmlText) {
    if (!htmlText || !htmlText.includes('<img')) return htmlText;
    const matches = Array.from(htmlText.matchAll(/<img\s+[^>]*?src=["']([^"']+)["']/gi));
    let result = htmlText;
    for (const m of matches) {
      const fn = m[1].trim();
      const uri = await getMediaDataUri(fn);
      if (uri) {
        result = result.replace(m[0], `<img src="${uri}"`);
      }
    }
    return result;
  }

  async function extractImagesFromHtml(htmlText, defaultSide = 'back') {
    if (!htmlText || typeof htmlText !== 'string' || !htmlText.includes('<img')) {
      return { cleanText: cleanHtml(htmlText || ''), images: [] };
    }
    const matches = Array.from(htmlText.matchAll(/<img\s+[^>]*?src=["']([^"']+)["'][^>]*>/gi));
    const images = [];
    let cleanText = htmlText;
    for (const m of matches) {
      const fn = m[1].trim();
      const uri = await getMediaDataUri(fn);
      if (uri) {
        const altMatch = m[0].match(/alt=["']([^"']+)["']/i);
        const name = altMatch ? altMatch[1] : (fn || `Image Attachment ${images.length + 1}`);
        images.push({
          id: `img_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
          url: uri,
          side: defaultSide,
          name: name
        });
      }
      cleanText = cleanText.replace(m[0], '');
    }
    return { cleanText: cleanHtml(cleanText), images };
  }

  // 3. Initialize WebAssembly SQLite database
  onProgress?.('Querying database in WebAssembly...', 60);
  const SQL = await window.initSqlJs({
    locateFile: (file) => `js/lib/${file}`
  });
  const db = new SQL.Database(dbBytes);

  // Check available tables
  const tablesResult = db.exec("SELECT name FROM sqlite_master WHERE type='table'");
  const tables = new Set(tablesResult[0]?.values.map(v => v[0]) || []);

  // Extract Decks
  let rawDecks = [];
  if (tables.has('decks')) {
    const dRes = db.exec('SELECT id, name FROM decks');
    if (dRes.length) rawDecks = dRes[0].values.map(v => [Number(v[0]), v[1]]);
  } else {
    const colRes = db.exec('SELECT decks FROM col');
    if (colRes.length && colRes[0].values[0][0]) {
      try {
        const dJson = JSON.parse(colRes[0].values[0][0]);
        rawDecks = Object.entries(dJson).map(([k, v]) => [Number(k), v.name || 'Deck']);
      } catch (err) {
        console.warn('Failed to parse col.decks JSON:', err);
      }
    }
  }

  const deckHierarchy = {};
  for (const [did, dname] of rawDecks) {
    if (dname === 'Default' && rawDecks.length > 1) continue;
    deckHierarchy[did] = dname;
  }

  const groups = [];
  const deckIdToGroup = {};
  const createdGroups = {};

  function getOrCreateGroup(name, parentId = null, groupType = 'unit') {
    let cleanName = (name || '').trim();
    if (parentId && cleanName.startsWith('Bio ')) {
      cleanName = cleanName.slice(4).trim();
    }
    const key = `${parentId}_${cleanName}`;
    if (createdGroups[key]) {
      return createdGroups[key].id;
    }
    const gid = `grp_${groups.length + 1}_${Math.abs(hashString(cleanName)) % 100000}`;
    const gObj = {
      id: gid,
      parentId: parentId,
      name: cleanName,
      type: groupType,
      color: '#c05638',
      icon: groupType === 'class' ? 'folder' : 'deck',
      order: groups.length
    };
    groups.push(gObj);
    createdGroups[key] = gObj;
    return gid;
  }

  function hashString(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = (hash << 5) - hash + str.charCodeAt(i);
      hash |= 0;
    }
    return hash;
  }

  for (const [did, dname] of Object.entries(deckHierarchy)) {
    if (dname.includes('\x1f') || dname.includes('::')) {
      const parts = dname.split(/[\x1f]|::/).map(s => s.trim()).filter(Boolean);
      let parentId = null;
      parts.forEach((part, idx) => {
        const gtype = idx === 0 ? 'class' : 'unit';
        parentId = getOrCreateGroup(part, parentId, gtype);
      });
      deckIdToGroup[did] = parentId;
    } else {
      deckIdToGroup[did] = getOrCreateGroup(dname, null, 'class');
    }
  }

  if (!groups.length) {
    const defaultGid = getOrCreateGroup('Anki Import', null, 'class');
    deckIdToGroup[1] = defaultGid;
  }

  // Extract Note Models
  const notetypes = {};
  if (tables.has('notetypes')) {
    const ntRes = db.exec('SELECT id, name FROM notetypes');
    if (ntRes.length) {
      for (const [ntid, name] of ntRes[0].values) {
        const fldRes = db.exec(`SELECT ord, name FROM fields WHERE ntid=${ntid} ORDER BY ord`);
        const flds = fldRes.length ? fldRes[0].values.map(f => f[1]) : [];
        notetypes[ntid] = { name, fields: flds };
      }
    }
  } else {
    const colRes = db.exec('SELECT models FROM col');
    if (colRes.length && colRes[0].values[0][0]) {
      try {
        const mJson = JSON.parse(colRes[0].values[0][0]);
        for (const [k, v] of Object.entries(mJson)) {
          notetypes[Number(k)] = {
            name: v.name || 'Basic',
            fields: (v.flds || []).map(f => f.name)
          };
        }
      } catch (err) {
        console.warn('Failed to parse col.models JSON:', err);
      }
    }
  }

  // 4. Extract Cards & Notes
  onProgress?.('Converting notes, cloze deletions and diagrams...', 75);
  const cardRows = db.exec('SELECT id, nid, ord, did FROM cards')[0]?.values || [];
  const cardToDeck = {};
  for (const [, nid, , did] of cardRows) {
    cardToDeck[nid] = did;
  }

  const notesRows = db.exec('SELECT id, mid, flds, tags FROM notes')[0]?.values || [];
  const cards = [];
  const ioDiagramGroups = new Map();

  let clozeCount = 0;
  let basicCount = 0;

  for (const [nid, mid, fldsStr, tagsStr] of notesRows) {
    const model = notetypes[mid] || { name: 'Basic', fields: ['Front', 'Back'] };
    const mname = (model.name || '').toLowerCase();
    const fldNames = model.fields || [];
    const fldValues = (fldsStr || '').split('\x1f');
    const fldDict = {};
    fldNames.forEach((name, idx) => {
      fldDict[name] = fldValues[idx] || '';
    });

    const did = cardToDeck[nid];
    const groupId = deckIdToGroup[did] || (groups[0]?.id || 'grp_default');
    const tags = (tagsStr || '').split(/\s+/).map(t => t.trim()).filter(Boolean);

    // A. Image Occlusion Note
    if (mname.includes('occlusion') || ('Image' in fldDict && ('Original Mask' in fldDict || 'Question Mask' in fldDict))) {
      const imgTag = fldDict['Image'] || '';
      const imgMatch = imgTag.match(/src=["']([^"']+)["']/i);
      const imgFilename = imgMatch ? imgMatch[1] : '';

      const origMaskTag = fldDict['Original Mask'] || '';
      const svgMatch = origMaskTag.match(/src=["']([^"']+)["']/i);
      const origSvgFn = svgMatch ? svgMatch[1] : '';

      const diagKey = `${imgFilename}|${origSvgFn}|${groupId}`;
      if (!ioDiagramGroups.has(diagKey)) {
        ioDiagramGroups.set(diagKey, {
          imgFilename,
          origSvgFn,
          groupId,
          notes: []
        });
      }
      ioDiagramGroups.get(diagKey).notes.push({ nid, fldDict, tags });
    }
    // B. Cloze Deletion Note
    else if (mname.includes('cloze') || fldValues.some(fv => fv.includes('{{c'))) {
      const textField = fldDict['Text'] || fldValues[0] || '';
      const backExtraField = fldDict['Back Extra'] || fldValues[1] || '';

      const { clozeText: convertedCloze, back: clozeBack } = convertAnkiHtmlCloze(textField, backExtraField);
      const rawCloze = convertedCloze || textField;
      const rawBack = clozeBack || backExtraField;

      const clozeImgRes = await extractImagesFromHtml(rawCloze, 'front');
      const backImgRes = await extractImagesFromHtml(rawBack, 'back');
      const cardImages = [...clozeImgRes.images, ...backImgRes.images];

      const plainSummary = clozeImgRes.cleanText.replace(/\{\{c\d+::(.*?)(?:::.*?)?\}\}/g, '[...]').replace(/<[^>]+>/g, '').trim();
      const frontLabel = `Cloze: ${plainSummary.slice(0, 45)}${plainSummary.length > 45 ? '...' : ''}`;

      cards.push({
        id: `card_cloze_${nid}`,
        groupId: groupId,
        type: 'cloze',
        front: frontLabel,
        back: backImgRes.cleanText,
        clozeText: clozeImgRes.cleanText,
        clozeMode: 'hide_all_guess_one',
        imageUrl: cardImages[0]?.url || '',
        images: cardImages,
        imageSide: cardImages[0]?.side || 'back',
        tags: [...tags, 'anki-cloze'],
        srs: {
          interval: 0,
          easeFactor: 2.5,
          reps: 0,
          state: 'new'
        }
      });
      clozeCount++;
    }
    // C. Basic Note (or converted to Image card if images exist)
    else {
      const frontField = fldDict['Front'] || fldValues[0] || '';
      const backField = fldDict['Back'] || fldValues[1] || '';

      const frontImgRes = await extractImagesFromHtml(frontField, 'front');
      const backImgRes = await extractImagesFromHtml(backField, 'back');
      const cardImages = [...frontImgRes.images, ...backImgRes.images];
      const hasImages = cardImages.length > 0;
      const cardType = hasImages ? 'image' : 'basic';

      cards.push({
        id: `card_basic_${nid}`,
        groupId: groupId,
        type: cardType,
        front: frontImgRes.cleanText || (hasImages ? 'Attached Diagram / Question' : 'Flashcard'),
        back: backImgRes.cleanText,
        hint: '',
        imageUrl: cardImages[0]?.url || '',
        images: cardImages,
        imageSide: cardImages[0]?.side || 'back',
        tags: [...tags, 'anki', ...(hasImages ? ['image'] : [])],
        srs: {
          interval: 0,
          easeFactor: 2.5,
          reps: 0,
          state: 'new'
        }
      });
      basicCount++;
    }
  }

  // 5. Build Image Occlusion Diagram Cards
  onProgress?.('Generating interactive diagram occlusion masks...', 90);
  let ioCardsCount = 0;
  for (const { imgFilename, origSvgFn, groupId, notes } of ioDiagramGroups.values()) {
    let boxes = [];
    if (origSvgFn) {
      const svgBytes = await getMediaBytes(origSvgFn);
      if (svgBytes) {
        const decoder = new TextDecoder('utf-8', { fatal: false });
        const svgText = decoder.decode(svgBytes);
        boxes = parseSvgOcclusionBoxes(svgText);
      }
    }

    const imageDataUri = imgFilename ? await getMediaDataUri(imgFilename) : '';

    const headers = notes.map(n => cleanHtml(n.fldDict['Header'] || '')).filter(Boolean);
    const remarks = notes.map(n => cleanHtml(n.fldDict['Remarks'] || '')).filter(Boolean);
    const extras = notes.map(n => cleanHtml(n.fldDict['Extra 1'] || '')).filter(Boolean);

    const allTags = new Set();
    notes.forEach(n => n.tags.forEach(t => allTags.add(t)));

    const frontTitle = headers[0] || 'Identify diagram labels';
    const backNotes = Array.from(new Set([...remarks, ...extras])).join('\n');
    const firstNid = notes[0].nid;

    cards.push({
      id: `card_io_diag_${firstNid}`,
      groupId: groupId,
      type: 'image_occlusion',
      front: frontTitle,
      back: backNotes,
      hint: remarks[0] || '',
      imageUrl: imageDataUri,
      imageOcclusions: boxes,
      occlusionMode: 'hide_all_guess_one',
      boxSrs: {},
      tags: [...allTags, 'anki-occlusion'],
      srs: {
        interval: 0,
        easeFactor: 2.5,
        reps: 0,
        state: 'new'
      }
    });
    ioCardsCount++;
  }

  db.close();

  onProgress?.('Import complete!', 100);

  return {
    groups,
    cards,
    summary: {
      totalCards: cards.length,
      clozeCards: clozeCount,
      basicCards: basicCount,
      occlusionCards: ioCardsCount,
      groupsCount: groups.length
    }
  };
}
