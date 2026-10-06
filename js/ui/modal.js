/**
 * Modal Dialogs System
 * Handles Folder/Group management, Import/Export backups, and User Settings.
 */

import { storage } from '../storage.js';
import { GROUP_TYPES, createGroup } from '../models.js';

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
          <h3 id="group-modal-title">New Folder / Subject</h3>
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
                <label class="form-label" for="select-group-type">Hierarchy Level</label>
                <select class="form-input" id="select-group-type">
                  <option value="${GROUP_TYPES.CLASS}">Class / Subject (Root)</option>
                  <option value="${GROUP_TYPES.UNIT}">Unit</option>
                  <option value="${GROUP_TYPES.LESSON}">Lesson</option>
                  <option value="${GROUP_TYPES.CONCEPT}">Concept</option>
                  <option value="${GROUP_TYPES.CUSTOM}">Custom Folder</option>
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
      titleEl.textContent = 'Edit Folder';
      nameInput.value = g.name;
      typeSelect.value = g.type || GROUP_TYPES.CUSTOM;
      colorInput.value = g.color || '#c05638';
      parentSelect.value = g.parentId || '';
    } else {
      titleEl.textContent = 'New Folder / Subject';
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
      <div class="modal-window animate-scale-up">
        <div class="modal-header">
          <h3>Share & Backup Decks</h3>
          <button class="btn-close" id="btn-close-io-modal">&times;</button>
        </div>
        <div class="modal-body">
          <div class="io-tabs">
            <button class="tab-btn active" id="tab-btn-export">Export Decks</button>
            <button class="tab-btn" id="tab-btn-import">Import Decks</button>
          </div>

          <!-- Export Tab -->
          <div id="io-section-export" class="io-section">
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

          <!-- Import Tab -->
          <div id="io-section-import" class="io-section hidden">
            <p class="io-description">
              Import a deck backup file (.json) shared by a teacher or classmate.
            </p>

            <div class="import-dropzone" id="import-dropzone">
              <input type="file" id="input-import-file" accept=".json" class="file-input-hidden"/>
              <div class="upload-zone-content">
                <span class="upload-icon">📄</span>
                <span>Click to select a .json file or drag it here</span>
              </div>
            </div>

            <div class="form-group" style="margin-top: 14px;">
              <label class="form-label">Import Mode</label>
              <div class="radio-group">
                <label class="radio-label">
                  <input type="radio" name="importMode" value="merge" checked/>
                  Merge with existing cards (Recommended)
                </label>
                <label class="radio-label">
                  <input type="radio" name="importMode" value="replace"/>
                  Replace existing collection
                </label>
              </div>
            </div>

            <div id="import-status-box" class="import-status hidden"></div>

            <div class="io-action-box">
              <button class="btn btn-primary btn-block" id="btn-trigger-import" disabled>
                Import Cards Now
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

    // Import file handling
    const dropzone = el.querySelector('#import-dropzone');
    const fileInput = el.querySelector('#input-import-file');
    const btnImport = el.querySelector('#btn-trigger-import');
    const statusBox = el.querySelector('#import-status-box');

    let parsedImportData = null;

    dropzone.onclick = () => fileInput.click();
    fileInput.onchange = (e) => {
      const file = e.target.files[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (event) => {
        try {
          parsedImportData = JSON.parse(event.target.result);
          const cardsCount = (parsedImportData.cards || []).length;
          const groupsCount = (parsedImportData.groups || []).length;

          statusBox.innerHTML = `✅ Found <strong>${cardsCount} cards</strong> in <strong>${groupsCount} folders</strong>.`;
          statusBox.className = 'import-status success';
          statusBox.classList.remove('hidden');
          btnImport.disabled = false;
        } catch (err) {
          statusBox.innerHTML = `❌ Error reading JSON file: ${err.message}`;
          statusBox.className = 'import-status error';
          statusBox.classList.remove('hidden');
          btnImport.disabled = true;
          parsedImportData = null;
        }
      };
      reader.readAsText(file);
    };

    btnImport.onclick = async () => {
      if (!parsedImportData) return;
      const mode = el.querySelector('input[name="importMode"]:checked').value;
      try {
        const result = await storage.importData(parsedImportData, mode);
        alert(`Successfully imported ${result.cardsCount} cards and ${result.groupsCount} folders!`);
        el.classList.add('hidden');
        window.dispatchEvent(new CustomEvent('groups-updated'));
      } catch (err) {
        alert(`Import failed: ${err.message}`);
      }
    };
  }

  async openImportExportModal(options = {}) {
    const groups = await storage.getGroups();
    const select = this.ioModalEl.querySelector('#select-export-scope');
    select.innerHTML = '<option value="">Whole Collection (All Classes & Decks)</option>';

    for (const g of groups) {
      const opt = document.createElement('option');
      opt.value = g.id;
      opt.textContent = `${g.name} (${g.type || 'folder'})`;
      if (options.defaultGroupId && g.id === options.defaultGroupId) {
        opt.selected = true;
      }
      select.appendChild(opt);
    }

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
