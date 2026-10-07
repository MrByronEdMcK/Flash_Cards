/**
 * Modal Dialogs System
 * Handles Folder/Group management, Import/Export backups, and User Settings.
 */

import { storage } from '../storage.js';
import { GROUP_TYPES, CARD_TYPES, createGroup, createCard } from '../models.js';
import { IMPORT_SERVICES, parseImport } from '../importers.js';

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export class ModalManager {
  constructor() {
    this._initGroupModal();
    this._initImportExportModal();
    this._initSettingsModal();
  }

  // --- Group (Folder) Modal ---
  _initGroupModal() {
    const el = document.createElement('div');
    el.className = 'modal-backdrop hidden';
    el.id = 'group-modal';
    el.innerHTML = `
      <div class="modal-window animate-scale-up">
        <div class="modal-header">
          <h3 id="group-modal-title">New Folder / Deck</h3>
          <button class="btn-close" id="btn-close-group-modal">&times;</button>
        </div>
        <div class="modal-body">
          <form id="group-form">
            <div class="form-group">
              <label class="form-label" for="input-group-name">Name</label>
              <input type="text" class="form-input" id="input-group-name" required placeholder="e.g. Chemistry, Unit 2, Photosynthesis"/>
            </div>

            <div class="form-row-2">
              <div class="form-group">
                <label class="form-label" for="select-group-type">Folder / Deck Level</label>
                <select class="form-input" id="select-group-type">
                  <option value="${GROUP_TYPES.CLASS}">Class / Subject (Main Level)</option>
                  <option value="${GROUP_TYPES.UNIT}">Unit</option>
                  <option value="${GROUP_TYPES.LESSON}">Lesson</option>
                  <option value="${GROUP_TYPES.CONCEPT}">Concept</option>
                  <option value="${GROUP_TYPES.CUSTOM}">Custom Deck</option>
                </select>
              </div>

              <div class="form-group">
                <label class="form-label" for="input-group-color">Color Accent</label>
                <input type="color" class="form-input-color" id="input-group-color" value="#c05638"/>
              </div>
            </div>

            <div class="form-group">
              <label class="form-label" for="select-group-parent">Parent Folder</label>
              <select class="form-input" id="select-group-parent">
                <option value="">None (Top-level Class)</option>
              </select>
            </div>

            <div class="modal-footer">
              <button type="button" class="btn btn-secondary" id="btn-cancel-group">Cancel</button>
              <button type="submit" class="btn btn-primary" id="btn-save-group">Save</button>
            </div>
          </form>
        </div>
      </div>
    `;
    document.body.appendChild(el);

    this.groupModalEl = el;
    this.editingGroupId = null;

    el.querySelector('#btn-close-group-modal').onclick = () => this.closeGroupModal();
    el.querySelector('#btn-cancel-group').onclick = () => this.closeGroupModal();

    el.querySelector('#group-form').onsubmit = async (e) => {
      e.preventDefault();
      const name = el.querySelector('#input-group-name').value.trim();
      const type = el.querySelector('#select-group-type').value;
      const color = el.querySelector('#input-group-color').value;
      const parentVal = el.querySelector('#select-group-parent').value;
      const parentId = parentVal ? parentVal : null;

      if (!name) return;

      if (this.editingGroupId) {
        const existing = await storage.getGroup(this.editingGroupId);
        if (existing) {
          existing.name = name;
          existing.type = type;
          existing.color = color;
          existing.parentId = parentId;
          await storage.saveGroup(existing);
        }
      } else {
        const group = createGroup({ name, type, color, parentId });
        await storage.saveGroup(group);
      }

      this.closeGroupModal();
      window.dispatchEvent(new CustomEvent('groups-updated'));
    };
  }

  async openGroupModal(options = {}) {
    this.editingGroupId = options.groupId || null;
    const parentId = options.parentId || null;
    const groups = await storage.getGroups();

    const titleEl = this.groupModalEl.querySelector('#group-modal-title');
    const nameInput = this.groupModalEl.querySelector('#input-group-name');
    const typeSelect = this.groupModalEl.querySelector('#select-group-type');
    const colorInput = this.groupModalEl.querySelector('#input-group-color');
    const parentSelect = this.groupModalEl.querySelector('#select-group-parent');

    // Populate parents
    parentSelect.innerHTML = '<option value="">None (Top-level Class)</option>';
    for (const g of groups) {
      if (this.editingGroupId && g.id === this.editingGroupId) continue; // Prevent parenting to self
      const opt = document.createElement('option');
      opt.value = g.id;
      opt.textContent = `${g.name} (${g.type || 'folder'})`;
      parentSelect.appendChild(opt);
    }

    if (this.editingGroupId) {
      const g = await storage.getGroup(this.editingGroupId);
      titleEl.textContent = 'Edit Folder / Deck';
      nameInput.value = g.name;
      typeSelect.value = g.type || GROUP_TYPES.CUSTOM;
      colorInput.value = g.color || '#c05638';
      parentSelect.value = g.parentId || '';
    } else {
      titleEl.textContent = 'New Folder / Deck';
      nameInput.value = '';
      colorInput.value = '#c05638';
      if (parentId) {
        parentSelect.value = parentId;
        const parent = groups.find(g => g.id === parentId);
        if (parent) {
          if (parent.type === GROUP_TYPES.CLASS) typeSelect.value = GROUP_TYPES.UNIT;
          else if (parent.type === GROUP_TYPES.UNIT) typeSelect.value = GROUP_TYPES.LESSON;
          else if (parent.type === GROUP_TYPES.LESSON) typeSelect.value = GROUP_TYPES.CONCEPT;
          else typeSelect.value = GROUP_TYPES.CUSTOM;
        }
      } else {
        parentSelect.value = '';
        typeSelect.value = GROUP_TYPES.CLASS;
      }
    }

    this.groupModalEl.classList.remove('hidden');
    nameInput.focus();
  }

  closeGroupModal() {
    this.groupModalEl.classList.add('hidden');
    this.editingGroupId = null;
  }

  // --- Import / Export Modal ---
  _initImportExportModal() {
    const el = document.createElement('div');
    el.className = 'modal-backdrop hidden';
    el.id = 'import-export-modal';
    el.innerHTML = `
      <div class="modal-window modal-window-lg animate-scale-up">
        <div class="modal-header">
          <h3 id="io-modal-title">Deck Import & Backup</h3>
          <button class="btn-close" id="btn-close-io-modal">&times;</button>
        </div>
        <div class="modal-body">
          <div class="io-tabs">
            <button class="tab-btn active" id="tab-btn-import">📥 Import Cards</button>
            <button class="tab-btn" id="tab-btn-export">📤 Export & Backup</button>
          </div>

          <!-- Import Tab -->
          <div id="io-section-import" class="io-section">
            <div id="import-form-view">
              <p class="io-description">
                Import cards from <strong>Anki</strong>, <strong>Quizlet</strong>, <strong>RemNote</strong>, <strong>Brainscape</strong>, <strong>Cram.com</strong>, <strong>Knowt</strong>, <strong>CSV/TSV</strong>, or a <strong>StudyCards Backup</strong>.
              </p>

              <!-- Service Selector -->
              <div class="form-group" style="margin-top: 12px;">
                <label class="form-label" for="select-import-service">1. Flashcard Source</label>
                <select class="form-input" id="select-import-service">
                  <option value="auto">✨ Auto-Detect Format</option>
                  <option value="quizlet">🔵 Quizlet (Text / TSV / CSV)</option>
                  <option value="anki">🟢 Anki (Plain Text .txt / .tsv with Cloze)</option>
                  <option value="remnote">🟣 RemNote (Markdown / Text .md / .txt)</option>
                  <option value="brainscape">🟠 Brainscape (CSV)</option>
                  <option value="cram">🟡 Cram.com (TSV / CSV)</option>
                  <option value="knowt">🔴 Knowt (Text / CSV / JSON)</option>
                  <option value="delimited">📄 Universal CSV / TSV</option>
                  <option value="studycards">🎴 StudyCards Backup (.json)</option>
                </select>
                <div id="import-service-guide" class="import-service-guide"></div>
              </div>

              <!-- Input Method Switcher -->
              <div class="form-group" style="margin-top: 12px;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                  <label class="form-label" style="margin: 0;">2. Import Method</label>
                  <div class="import-method-toggle">
                    <button type="button" class="method-toggle-btn active" id="btn-mode-file">📁 Upload File</button>
                    <button type="button" class="method-toggle-btn" id="btn-mode-paste">📋 Paste Text</button>
                  </div>
                </div>

                <!-- File Dropzone -->
                <div id="panel-import-file" class="import-panel">
                  <div class="import-dropzone" id="import-dropzone">
                    <input type="file" id="input-import-file" accept=".txt,.tsv,.csv,.json,.md,.tab" class="file-input-hidden"/>
                    <div class="upload-zone-content">
                      <span class="upload-icon">📄</span>
                      <span id="import-file-label" class="upload-label-main">Click or drag a flashcard file here</span>
                      <span class="upload-label-sub">Accepts .txt, .tsv, .csv, .json, .md files</span>
                    </div>
                  </div>
                </div>

                <!-- Paste Text Area -->
                <div id="panel-import-paste" class="import-panel hidden">
                  <textarea class="form-input form-textarea font-mono" id="textarea-import-paste" rows="4" placeholder="Paste your exported flashcard text here...&#10;Example:&#10;Mitochondria&#9;The powerhouse of the cell&#10;Chloroplast&#9;Site of photosynthesis in plants"></textarea>
                </div>
              </div>

              <!-- Destination Selector (For card imports) -->
              <div id="group-dest-picker" class="form-group" style="margin-top: 14px;">
                <label class="form-label">3. Destination Folder / Deck</label>
                <div class="dest-choice-box">
                  <label class="radio-label">
                    <input type="radio" name="destChoice" value="new" checked/>
                    <span>Create a new deck:</span>
                  </label>
                  <div class="dest-sub-input">
                    <input type="text" class="form-input" id="input-new-deck-name" placeholder="Deck Name (e.g. Biology Ch 1)"/>
                  </div>

                  <label class="radio-label" style="margin-top: 8px;">
                    <input type="radio" name="destChoice" value="existing"/>
                    <span>Add to existing folder / deck:</span>
                  </label>
                  <div class="dest-sub-input">
                    <select class="form-input" id="select-target-group" disabled></select>
                  </div>
                </div>
              </div>

              <!-- Native Backup Restore Options (only shown for StudyCards JSON) -->
              <div id="group-native-backup-options" class="form-group hidden" style="margin-top: 14px;">
                <label class="form-label">3. Restore Mode</label>
                <div class="radio-group">
                  <label class="radio-label">
                    <input type="radio" name="nativeImportMode" value="merge" checked/>
                    Merge with existing decks and cards (Recommended)
                  </label>
                  <label class="radio-label">
                    <input type="radio" name="nativeImportMode" value="replace"/>
                    Replace entire collection
                  </label>
                </div>
              </div>

              <!-- Live Digest Preview Box -->
              <div id="import-preview-box" class="import-preview-box hidden" style="margin-top: 16px;">
                <div class="preview-status-header">
                  <div class="preview-status-title" id="preview-status-title"></div>
                  <div class="preview-type-tags" id="preview-type-tags"></div>
                </div>

                <div id="preview-warnings-box" class="preview-warnings-box hidden">
                  <div class="preview-warnings-bar">
                    <span id="preview-warnings-text">⚠️ 0 lines skipped</span>
                    <button type="button" class="btn-warning-toggle" id="btn-toggle-warnings">Details ▼</button>
                  </div>
                  <div id="preview-warnings-list" class="preview-warnings-list hidden"></div>
                </div>

                <div class="preview-samples-wrapper" id="preview-samples-wrapper">
                  <div class="preview-samples-header">Sample Card Preview</div>
                  <div id="preview-samples-content" class="preview-samples-content"></div>
                </div>
              </div>

              <!-- Trigger Button -->
              <div class="io-action-box" style="margin-top: 16px;">
                <button class="btn btn-primary btn-block" id="btn-trigger-import" disabled>
                  📥 Import Cards Now
                </button>
              </div>
            </div>

            <!-- Finished Digest View -->
            <div id="import-finished-digest" class="import-finished-digest hidden">
              <div class="digest-card animate-scale-up">
                <div class="digest-icon">🎉</div>
                <h3 class="digest-title">Import Complete!</h3>
                <p class="digest-subtitle" id="digest-subtitle"></p>
                <div class="digest-stats-grid">
                  <div class="digest-stat-item">
                    <span class="stat-num" id="digest-stat-cards">0</span>
                    <span class="stat-lbl">Cards Added</span>
                  </div>
                  <div class="digest-stat-item">
                    <span class="stat-num" id="digest-stat-source">-</span>
                    <span class="stat-lbl">Source Format</span>
                  </div>
                  <div class="digest-stat-item">
                    <span class="stat-num" id="digest-stat-skipped">0</span>
                    <span class="stat-lbl">Skipped</span>
                  </div>
                </div>
                <div id="digest-warnings-block" class="digest-warnings-block hidden"></div>
                <div class="digest-actions">
                  <button type="button" class="btn btn-secondary" id="btn-digest-close">Close</button>
                  <button type="button" class="btn btn-primary" id="btn-digest-view">Go to Deck</button>
                </div>
              </div>
            </div>
          </div>

          <!-- Export Tab -->
          <div id="io-section-export" class="io-section hidden">
            <p class="io-description">
              Download your cards and hierarchical folders into a single backup file to save on your Google Drive or share with classmates.
            </p>

            <div class="backup-tip-banner" style="background: var(--bg-subtle); border: 1px solid var(--border-color); border-radius: var(--radius-sm); padding: 0.75rem 1rem; margin: 12px 0; font-size: 0.8rem; color: var(--text-muted); display: flex; align-items: flex-start; gap: 0.6rem;">
              <span style="font-size: 1.2rem; line-height: 1;">💾</span>
              <div>
                <strong style="color: var(--text-main);">School Google Drive Tip:</strong>
                <div>Save this backup file directly into your McKinnon Google Drive folder (via Chromebook Files or Mac/PC Drive). If you ever change devices or clear your browser, you can restore all your cards in 1 second.</div>
              </div>
            </div>

            <div class="form-group" style="margin-top: 14px;">
              <label class="form-label" for="select-export-scope">Folder to Export</label>
              <select class="form-input" id="select-export-scope">
                <option value="">Whole Collection (All Classes & Decks)</option>
              </select>
            </div>

            <div class="io-action-box">
              <button class="btn btn-primary btn-block" id="btn-trigger-export">
                📥 Download Backup File (.json)
              </button>
            </div>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(el);
    this.ioModalEl = el;

    this._wireImportExportEvents();
  }

  _wireImportExportEvents() {
    const el = this.ioModalEl;
    el.querySelector('#btn-close-io-modal').onclick = () => el.classList.add('hidden');

    const tabExport = el.querySelector('#tab-btn-export');
    const tabImport = el.querySelector('#tab-btn-import');
    const secExport = el.querySelector('#io-section-export');
    const secImport = el.querySelector('#io-section-import');

    tabExport.onclick = () => {
      tabExport.classList.add('active');
      tabImport.classList.remove('active');
      secExport.classList.remove('hidden');
      secImport.classList.add('hidden');
    };

    tabImport.onclick = () => {
      tabImport.classList.add('active');
      tabExport.classList.remove('active');
      secImport.classList.remove('hidden');
      secExport.classList.add('hidden');
    };

    // Export handler
    el.querySelector('#btn-trigger-export').onclick = async () => {
      const scopeVal = el.querySelector('#select-export-scope').value;
      const targetGroupId = scopeVal ? scopeVal : null;
      const data = await storage.exportData(targetGroupId);
      const jsonStr = JSON.stringify(data, null, 2);
      const blob = new Blob([jsonStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);

      const a = document.createElement('a');
      a.href = url;
      const datePart = new Date().toISOString().split('T')[0];
      a.download = targetGroupId ? `StudyCards_Deck_${datePart}.json` : `StudyCards_Backup_${datePart}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    };

    // Importer State
    let currentInputMode = 'file'; // 'file' or 'paste'
    let currentFileText = '';
    let currentFileName = '';
    let currentPasteText = '';
    let currentParsed = null;
    let lastImportedGroupId = null;

    const selectService = el.querySelector('#select-import-service');
    const guideBox = el.querySelector('#import-service-guide');
    const btnModeFile = el.querySelector('#btn-mode-file');
    const btnModePaste = el.querySelector('#btn-mode-paste');
    const panelFile = el.querySelector('#panel-import-file');
    const panelPaste = el.querySelector('#panel-import-paste');
    const dropzone = el.querySelector('#import-dropzone');
    const fileInput = el.querySelector('#input-import-file');
    const fileLabel = el.querySelector('#import-file-label');
    const textareaPaste = el.querySelector('#textarea-import-paste');
    const destRadioNew = el.querySelector('input[name="destChoice"][value="new"]');
    const destRadioExisting = el.querySelector('input[name="destChoice"][value="existing"]');
    const inputDeckName = el.querySelector('#input-new-deck-name');
    const selectTargetGroup = el.querySelector('#select-target-group');
    const groupDestPicker = el.querySelector('#group-dest-picker');
    const groupNativeBackup = el.querySelector('#group-native-backup-options');
    const previewBox = el.querySelector('#import-preview-box');
    const previewTitle = el.querySelector('#preview-status-title');
    const previewBadges = el.querySelector('#preview-type-tags');
    const warningsBox = el.querySelector('#preview-warnings-box');
    const warningsText = el.querySelector('#preview-warnings-text');
    const warningsList = el.querySelector('#preview-warnings-list');
    const btnToggleWarnings = el.querySelector('#btn-toggle-warnings');
    const samplesWrapper = el.querySelector('#preview-samples-wrapper');
    const samplesContent = el.querySelector('#preview-samples-content');
    const btnTriggerImport = el.querySelector('#btn-trigger-import');

    const formView = el.querySelector('#import-form-view');
    const digestView = el.querySelector('#import-finished-digest');
    const digestSubtitle = el.querySelector('#digest-subtitle');
    const digestStatCards = el.querySelector('#digest-stat-cards');
    const digestStatSource = el.querySelector('#digest-stat-source');
    const digestStatSkipped = el.querySelector('#digest-stat-skipped');
    const digestWarningsBlock = el.querySelector('#digest-warnings-block');
    const btnDigestClose = el.querySelector('#btn-digest-close');
    const btnDigestView = el.querySelector('#btn-digest-view');

    // Service Guide updates
    const updateServiceGuide = (serviceKey) => {
      const s = IMPORT_SERVICES[serviceKey];
      if (s && s.instructions) {
        guideBox.innerHTML = `<strong>How to export from ${escapeHtml(s.name)}:</strong><br/>${escapeHtml(s.instructions)}`;
        guideBox.classList.remove('hidden');
      } else if (serviceKey === 'auto') {
        guideBox.innerHTML = `⚡ <strong>Auto-Detect:</strong> StudyCards will automatically identify format signatures from Quizlet, Anki, RemNote, Brainscape, Cram, Knowt, CSV/TSV, and StudyCards JSON.`;
        guideBox.classList.remove('hidden');
      } else {
        guideBox.classList.add('hidden');
      }
    };
    updateServiceGuide('auto');

    selectService.addEventListener('change', () => {
      const val = selectService.value;
      updateServiceGuide(val);
      runParseAndPreview();
    });

    // Input mode switcher
    btnModeFile.onclick = () => {
      currentInputMode = 'file';
      btnModeFile.classList.add('active');
      btnModePaste.classList.remove('active');
      panelFile.classList.remove('hidden');
      panelPaste.classList.add('hidden');
      runParseAndPreview();
    };

    btnModePaste.onclick = () => {
      currentInputMode = 'paste';
      btnModePaste.classList.add('active');
      btnModeFile.classList.remove('active');
      panelPaste.classList.remove('hidden');
      panelFile.classList.add('hidden');
      textareaPaste.focus();
      runParseAndPreview();
    };

    // Destination Radios
    const updateDestControls = () => {
      const isNew = destRadioNew.checked;
      inputDeckName.disabled = !isNew;
      selectTargetGroup.disabled = isNew;
    };
    destRadioNew.addEventListener('change', updateDestControls);
    destRadioExisting.addEventListener('change', updateDestControls);

    // File Drag & Drop + Browse
    dropzone.onclick = () => fileInput.click();

    dropzone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropzone.classList.add('drag-over');
    });

    dropzone.addEventListener('dragleave', () => {
      dropzone.classList.remove('drag-over');
    });

    dropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropzone.classList.remove('drag-over');
      if (e.dataTransfer.files && e.dataTransfer.files[0]) {
        handleSelectedFile(e.dataTransfer.files[0]);
      }
    });

    fileInput.addEventListener('change', (e) => {
      if (e.target.files && e.target.files[0]) {
        handleSelectedFile(e.target.files[0]);
      }
    });

    const handleSelectedFile = (file) => {
      currentFileName = file.name;
      const baseName = (file.name || '').split(/[\\/]/).pop() || '';
      fileLabel.textContent = `Selected: ${baseName} (${Math.round(file.size / 1024 * 10) / 10} KB)`;

      // Pre-fill deck name cleanly (strip extension and path)
      const stem = baseName.replace(/\.[^/.]+$/, '').replace(/[_-]/g, ' ').trim();
      if (stem && (!inputDeckName.value || inputDeckName.dataset.autoFilled)) {
        inputDeckName.value = stem.charAt(0).toUpperCase() + stem.slice(1);
        inputDeckName.dataset.autoFilled = 'true';
      }

      const reader = new FileReader();
      reader.onload = (ev) => {
        currentFileText = ev.target.result;
        runParseAndPreview();
      };
      reader.readAsText(file);
    };

    // Paste Textarea Handler
    let debounceTimer = null;
    textareaPaste.addEventListener('input', () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        currentPasteText = textareaPaste.value;
        runParseAndPreview();
      }, 150);
    });

    // Toggle warnings detail
    btnToggleWarnings.onclick = () => {
      const isHidden = warningsList.classList.toggle('hidden');
      btnToggleWarnings.textContent = isHidden ? 'Details ▼' : 'Hide ▲';
    };

    // Live Parser & Preview Function
    const runParseAndPreview = () => {
      const rawText = (currentInputMode === 'file' ? currentFileText : currentPasteText) || '';
      const chosenService = selectService.value;

      if (!rawText.trim()) {
        previewBox.classList.add('hidden');
        btnTriggerImport.disabled = true;
        btnTriggerImport.textContent = '📥 Import Cards Now';
        currentParsed = null;
        return;
      }

      const parsed = parseImport(rawText, chosenService, {
        fileName: currentFileName,
        deckName: inputDeckName.value.trim()
      });
      currentParsed = parsed;

      previewBox.classList.remove('hidden');

      // Native StudyCards Backup format
      if (parsed.isNativeBackup && parsed.success) {
        groupDestPicker.classList.add('hidden');
        groupNativeBackup.classList.remove('hidden');

        previewTitle.innerHTML = `<span>✅</span> <span>Found StudyCards Backup: <strong>${parsed.stats.validCards} cards</strong> in <strong>${parsed.stats.groupsCount} folders</strong></span>`;
        previewBadges.innerHTML = `
          <span class="type-tag-badge basic">${parsed.stats.validCards} Cards</span>
          <span class="type-tag-badge reversible">${parsed.stats.groupsCount} Folders</span>
        `;
        warningsBox.classList.add('hidden');
        samplesWrapper.classList.add('hidden');
        btnTriggerImport.disabled = false;
        btnTriggerImport.textContent = `📥 Restore ${parsed.stats.validCards} Cards Now`;
        return;
      }

      // Standard flashcards format (Quizlet, Anki, RemNote, Cram, Knowt, CSV, etc.)
      groupDestPicker.classList.remove('hidden');
      groupNativeBackup.classList.add('hidden');

      if (!parsed.success || parsed.cards.length === 0) {
        previewTitle.innerHTML = `<span>❌</span> <span>No flashcards could be parsed from this input</span>`;
        previewBadges.innerHTML = '';
        samplesWrapper.classList.add('hidden');

        if (parsed.warnings && parsed.warnings.length > 0) {
          warningsBox.classList.remove('hidden');
          warningsText.textContent = `⚠️ Parser encountered issues:`;
          warningsList.innerHTML = parsed.warnings.map(w => `
            <div class="warning-item">
              <span class="warning-line-badge">Line ${w.line}</span>
              <span>${escapeHtml(w.reason)} ${w.rawSnippet ? `<em>(${escapeHtml(w.rawSnippet)})</em>` : ''}</span>
            </div>
          `).join('');
        } else {
          warningsBox.classList.add('hidden');
        }

        btnTriggerImport.disabled = true;
        btnTriggerImport.textContent = '📥 Import Cards Now';
        return;
      }

      // Successful card parsing
      previewTitle.innerHTML = `<span>✅</span> <span>Detected <strong>${parsed.serviceName}</strong>: <strong>${parsed.cards.length} cards</strong> ready to import</span>`;

      // Card type badges
      const types = parsed.stats.cardTypes || {};
      let badgesHtml = '';
      if (types.basic) badgesHtml += `<span class="type-tag-badge basic">${types.basic} Basic</span>`;
      if (types.cloze) badgesHtml += `<span class="type-tag-badge cloze">${types.cloze} Cloze</span>`;
      if (types.reversible) badgesHtml += `<span class="type-tag-badge reversible">${types.reversible} Reversible</span>`;
      previewBadges.innerHTML = badgesHtml;

      // Warnings / Skipped Rows
      if (parsed.warnings && parsed.warnings.length > 0) {
        warningsBox.classList.remove('hidden');
        warningsText.textContent = `⚠️ ${parsed.warnings.length} line${parsed.warnings.length > 1 ? 's' : ''} skipped`;
        warningsList.innerHTML = parsed.warnings.map(w => `
          <div class="warning-item">
            <span class="warning-line-badge">Line ${w.line}</span>
            <span>${escapeHtml(w.reason)} ${w.rawSnippet ? `<em>(${escapeHtml(w.rawSnippet)})</em>` : ''}</span>
          </div>
        `).join('');
      } else {
        warningsBox.classList.add('hidden');
      }

      // Sample Cards Preview (First 3 cards)
      samplesWrapper.classList.remove('hidden');
      const samples = parsed.cards.slice(0, 3);
      samplesContent.innerHTML = samples.map((c, i) => `
        <div class="sample-card-item">
          <div class="sample-card-row">
            <span class="sample-card-lbl">Front:</span>
            <span class="sample-card-val">${escapeHtml(c.front || c.clozeText)}</span>
          </div>
          <div class="sample-card-row">
            <span class="sample-card-lbl">Back:</span>
            <span class="sample-card-val">${escapeHtml(c.back || '[Cloze Deletion]')}</span>
          </div>
        </div>
      `).join('');

      btnTriggerImport.disabled = false;
      btnTriggerImport.textContent = `📥 Import ${parsed.cards.length} Cards Now`;
      previewBox.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    };

    // Execute Import Action
    btnTriggerImport.onclick = async () => {
      if (!currentParsed || !currentParsed.success) return;

      btnTriggerImport.disabled = true;
      btnTriggerImport.textContent = '⏳ Importing cards...';

      try {
        if (currentParsed.isNativeBackup) {
          // Native backup restore
          const mode = el.querySelector('input[name="nativeImportMode"]:checked').value;
          const result = await storage.importData(currentParsed.nativeData, mode);

          digestSubtitle.innerHTML = `Successfully restored <strong>${result.cardsCount} cards</strong> across <strong>${result.groupsCount} folders</strong>!`;
          digestStatCards.textContent = result.cardsCount;
          digestStatSource.textContent = 'Backup';
          digestStatSkipped.textContent = '0';
          digestWarningsBlock.classList.add('hidden');
          lastImportedGroupId = null;
        } else {
          // Flashcards import (Quizlet, Anki, RemNote, etc.)
          let targetGroupId = null;
          let targetGroupName = '';

          if (destRadioNew.checked) {
            const rawName = inputDeckName.value.trim() || currentParsed.deckName || 'Imported Deck';
            const newGroup = createGroup({
              name: rawName,
              type: GROUP_TYPES.CUSTOM,
              icon: '🎴'
            });
            await storage.saveGroup(newGroup);
            targetGroupId = newGroup.id;
            targetGroupName = newGroup.name;
          } else {
            targetGroupId = selectTargetGroup.value;
            const groups = await storage.getGroups();
            const matched = groups.find(g => g.id === targetGroupId);
            targetGroupName = matched ? matched.name : 'Selected Deck';
          }

          lastImportedGroupId = targetGroupId;

          // Save parsed cards
          for (const card of currentParsed.cards) {
            const cardObj = createCard({
              groupId: targetGroupId,
              front: card.front,
              back: card.back,
              hint: card.hint || '',
              type: card.type || CARD_TYPES.BASIC,
              clozeText: card.clozeText || (card.type === CARD_TYPES.CLOZE ? card.front : ''),
              tags: Array.isArray(card.tags) && card.tags.length > 0 ? card.tags : ['imported']
            });
            await storage.saveCard(cardObj);
          }

          // Populate finished digest
          digestSubtitle.innerHTML = `Successfully imported <strong>${currentParsed.cards.length} cards</strong> into <strong>${escapeHtml(targetGroupName)}</strong>.`;
          digestStatCards.textContent = currentParsed.cards.length;
          digestStatSource.textContent = currentParsed.serviceName;
          digestStatSkipped.textContent = currentParsed.warnings.length;

          if (currentParsed.warnings && currentParsed.warnings.length > 0) {
            digestWarningsBlock.classList.remove('hidden');
            digestWarningsBlock.innerHTML = `
              <strong>⚠️ Skipped lines (${currentParsed.warnings.length}):</strong>
              <div style="margin-top: 4px; display: flex; flex-direction: column; gap: 3px;">
                ${currentParsed.warnings.slice(0, 10).map(w => `
                  <div><span class="warning-line-badge">Line ${w.line}</span> ${escapeHtml(w.reason)} ${w.rawSnippet ? `<em>(${escapeHtml(w.rawSnippet)})</em>` : ''}</div>
                `).join('')}
                ${currentParsed.warnings.length > 10 ? `<div><em>...and ${currentParsed.warnings.length - 10} more</em></div>` : ''}
              </div>
            `;
          } else {
            digestWarningsBlock.classList.add('hidden');
          }
        }

        // Show digest screen
        formView.classList.add('hidden');
        digestView.classList.remove('hidden');

        // Refresh app state
        window.dispatchEvent(new CustomEvent('groups-updated'));
      } catch (err) {
        alert(`Import error: ${err.message}`);
        btnTriggerImport.disabled = false;
        btnTriggerImport.textContent = `📥 Import ${currentParsed.cards.length} Cards Now`;
      }
    };

    // Digest Finish View Handlers
    btnDigestClose.onclick = () => {
      el.classList.add('hidden');
    };

    btnDigestView.onclick = () => {
      el.classList.add('hidden');
      if (lastImportedGroupId) {
        window.dispatchEvent(new CustomEvent('navigate-to', {
          detail: { view: 'decks', options: { focusGroupId: lastImportedGroupId } }
        }));
      } else {
        window.dispatchEvent(new CustomEvent('navigate-to', { detail: { view: 'decks' } }));
      }
    };
  }

  async openImportExportModal(options = {}) {
    const groups = await storage.getGroups();
    const selectExport = this.ioModalEl.querySelector('#select-export-scope');
    const selectTarget = this.ioModalEl.querySelector('#select-target-group');

    // Populate Export Select
    selectExport.innerHTML = '<option value="">Whole Collection (All Classes & Decks)</option>';
    for (const g of groups) {
      const opt = document.createElement('option');
      opt.value = g.id;
      opt.textContent = `${g.name} (${g.type || 'folder'})`;
      if (options.defaultGroupId && g.id === options.defaultGroupId) {
        opt.selected = true;
      }
      selectExport.appendChild(opt);
    }

    // Populate Import Target Select
    selectTarget.innerHTML = '';
    for (const g of groups) {
      const opt = document.createElement('option');
      opt.value = g.id;
      opt.textContent = `${g.name} (${g.type || 'folder'})`;
      if (options.defaultGroupId && g.id === options.defaultGroupId) {
        opt.selected = true;
      }
      selectTarget.appendChild(opt);
    }

    // Reset view states
    const formView = this.ioModalEl.querySelector('#import-form-view');
    const digestView = this.ioModalEl.querySelector('#import-finished-digest');
    if (formView) formView.classList.remove('hidden');
    if (digestView) digestView.classList.add('hidden');

    const previewBox = this.ioModalEl.querySelector('#import-preview-box');
    if (previewBox) previewBox.classList.add('hidden');

    const btnImport = this.ioModalEl.querySelector('#btn-trigger-import');
    if (btnImport) {
      btnImport.disabled = true;
      btnImport.textContent = '📥 Import Cards Now';
    }

    const fileLabel = this.ioModalEl.querySelector('#import-file-label');
    if (fileLabel) fileLabel.textContent = 'Click or drag a flashcard file here';

    const fileInput = this.ioModalEl.querySelector('#input-import-file');
    if (fileInput) fileInput.value = '';

    const textarea = this.ioModalEl.querySelector('#textarea-import-paste');
    if (textarea) textarea.value = '';

    const inputDeckName = this.ioModalEl.querySelector('#input-new-deck-name');
    if (inputDeckName) {
      inputDeckName.value = '';
      delete inputDeckName.dataset.autoFilled;
    }

    const destRadioNew = this.ioModalEl.querySelector('input[name="destChoice"][value="new"]');
    if (destRadioNew) destRadioNew.checked = true;
    if (inputDeckName) inputDeckName.disabled = false;
    if (selectTarget) selectTarget.disabled = true;

    this.ioModalEl.classList.remove('hidden');
  }

  // --- Settings Modal ---
  _initSettingsModal() {
    const el = document.createElement('div');
    el.className = 'modal-backdrop hidden';
    el.id = 'settings-modal';
    el.innerHTML = `
      <div class="modal-window animate-scale-up">
        <div class="modal-header">
          <h3>Study Settings</h3>
          <button class="btn-close" id="btn-close-settings-modal">&times;</button>
        </div>
        <div class="modal-body">
          <form id="settings-form">
            <div class="form-group">
              <label class="form-label" for="input-daily-goal">Daily Cards Target Goal</label>
              <input type="number" class="form-input" id="input-daily-goal" min="5" max="200" required/>
              <span class="form-help">Number of cards you aim to review each day to maintain your streak.</span>
            </div>

            <div class="form-group">
              <label class="form-label" for="select-theme">Appearance Theme</label>
              <select class="form-input" id="select-theme">
                <option value="light">Warm Beige (Light)</option>
                <option value="dark">Dark Roast (Night)</option>
              </select>
            </div>

            <div class="form-group">
              <label class="form-label">Accent Color</label>
              <div class="accent-color-picker" id="accent-color-options">
                <label class="accent-swatch-option">
                  <input type="radio" name="input-accent" value="orange" checked/>
                  <span class="accent-swatch" style="--swatch-color: #c05638;" title="Terracotta (Orange)"></span>
                  <span class="accent-swatch-label">Orange</span>
                </label>
                <label class="accent-swatch-option">
                  <input type="radio" name="input-accent" value="green"/>
                  <span class="accent-swatch" style="--swatch-color: #38734e;" title="Sage (Green)"></span>
                  <span class="accent-swatch-label">Green</span>
                </label>
                <label class="accent-swatch-option">
                  <input type="radio" name="input-accent" value="blue"/>
                  <span class="accent-swatch" style="--swatch-color: #366482;" title="Slate (Blue)"></span>
                  <span class="accent-swatch-label">Blue</span>
                </label>
                <label class="accent-swatch-option">
                  <input type="radio" name="input-accent" value="pink"/>
                  <span class="accent-swatch" style="--swatch-color: #b84e72;" title="Rose (Pink)"></span>
                  <span class="accent-swatch-label">Pink</span>
                </label>
                <label class="accent-swatch-option">
                  <input type="radio" name="input-accent" value="yellow"/>
                  <span class="accent-swatch" style="--swatch-color: #b87320;" title="Honey (Yellow)"></span>
                  <span class="accent-swatch-label">Yellow</span>
                </label>
                <label class="accent-swatch-option">
                  <input type="radio" name="input-accent" value="red"/>
                  <span class="accent-swatch" style="--swatch-color: #b83a3a;" title="Crimson (Red)"></span>
                  <span class="accent-swatch-label">Red</span>
                </label>
                <label class="accent-swatch-option">
                  <input type="radio" name="input-accent" value="purple"/>
                  <span class="accent-swatch" style="--swatch-color: #7d4e8d;" title="Plum (Purple)"></span>
                  <span class="accent-swatch-label">Purple</span>
                </label>
              </div>
            </div>

            <div class="modal-footer">
              <button type="button" class="btn btn-secondary" id="btn-cancel-settings">Cancel</button>
              <button type="submit" class="btn btn-primary">Save Settings</button>
            </div>
          </form>
        </div>
      </div>
    `;
    document.body.appendChild(el);
    this.settingsModalEl = el;

    const cancelSettings = async () => {
      const current = await storage.getSettings();
      document.documentElement.setAttribute('data-theme', current.theme || 'light');
      document.documentElement.setAttribute('data-accent', current.accent || 'orange');
      el.classList.add('hidden');
    };

    el.querySelector('#btn-close-settings-modal').onclick = cancelSettings;
    el.querySelector('#btn-cancel-settings').onclick = cancelSettings;

    // Live preview on theme / accent change
    el.querySelector('#select-theme').addEventListener('change', (e) => {
      document.documentElement.setAttribute('data-theme', e.target.value);
    });

    el.querySelectorAll('input[name="input-accent"]').forEach(radio => {
      radio.addEventListener('change', () => {
        document.documentElement.setAttribute('data-accent', radio.value);
      });
    });

    el.querySelector('#settings-form').onsubmit = async (e) => {
      e.preventDefault();
      const goal = parseInt(el.querySelector('#input-daily-goal').value, 10) || 20;
      const theme = el.querySelector('#select-theme').value;
      const accentRadio = el.querySelector('input[name="input-accent"]:checked');
      const accent = accentRadio ? accentRadio.value : 'orange';

      const current = await storage.getSettings();
      current.dailyNewLimit = goal;
      current.theme = theme;
      current.accent = accent;
      await storage.saveSettings(current);

      document.documentElement.setAttribute('data-theme', theme);
      document.documentElement.setAttribute('data-accent', accent);
      el.classList.add('hidden');
      window.dispatchEvent(new CustomEvent('settings-updated'));
    };
  }

  async openSettingsModal() {
    const settings = await storage.getSettings();
    this.settingsModalEl.querySelector('#input-daily-goal').value = settings.dailyNewLimit || 20;
    this.settingsModalEl.querySelector('#select-theme').value = settings.theme || 'light';
    const accent = settings.accent || 'orange';
    const accentRadio = this.settingsModalEl.querySelector(`input[name="input-accent"][value="${accent}"]`);
    if (accentRadio) accentRadio.checked = true;
    this.settingsModalEl.classList.remove('hidden');
  }
}
