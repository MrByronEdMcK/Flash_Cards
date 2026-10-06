/**
 * Card Editor Modal
 * Rich card creator supporting: Basic, Reversible, Cloze, Image, and Image Occlusion.
 */

import { storage } from '../storage.js';
import { CARD_TYPES, OCCLUSION_MODES, createCard, getClozeNumbers } from '../models.js';
import { OcclusionEditor } from '../occlusionCanvas.js';

export class CardEditorModal {
  constructor() {
    this.modalEl = null;
    this.currentCard = null;
    this.occlusionEditor = null;
    this.activeType = CARD_TYPES.BASIC;
    this._createDOM();
  }

  _createDOM() {
    this.modalEl = document.createElement('div');
    this.modalEl.className = 'modal-backdrop hidden';
    this.modalEl.id = 'card-editor-modal';
    this.modalEl.innerHTML = `
      <div class="modal-window modal-wide animate-scale-up">
        <div class="modal-header">
          <h3 id="card-editor-title">Create Flashcard</h3>
          <button class="btn-close" id="btn-close-card-editor">&times;</button>
        </div>

        <div class="modal-body">
          <form id="card-editor-form">
            <!-- Top Controls: Card Type & Destination Group -->
            <div class="form-row-2">
              <div class="form-group">
                <label class="form-label">Card Type</label>
                <div class="type-selector-pills">
                  <button type="button" class="pill-btn active" data-type="${CARD_TYPES.BASIC}">Basic</button>
                  <button type="button" class="pill-btn" data-type="${CARD_TYPES.REVERSIBLE}">Reversible</button>
                  <button type="button" class="pill-btn" data-type="${CARD_TYPES.CLOZE}">Cloze</button>
                  <button type="button" class="pill-btn" data-type="${CARD_TYPES.IMAGE}">Image</button>
                  <button type="button" class="pill-btn" data-type="${CARD_TYPES.IMAGE_OCCLUSION}">Image Occlusion</button>
                </div>
              </div>

              <div class="form-group">
                <label class="form-label" for="card-group-select">Folder / Subject</label>
                <select class="form-input" id="card-group-select" required></select>
              </div>
            </div>

            <!-- Dynamic Fields Container -->
            <div id="dynamic-fields-area">
              <!-- Basic & Reversible Fields -->
              <div class="card-type-section" id="section-basic">
                <div class="form-group">
                  <label class="form-label" for="input-card-front">Front (Prompt / Question)</label>
                  <textarea class="form-input form-textarea" id="input-card-front" rows="3" placeholder="What is the powerhouse of the cell?"></textarea>
                </div>

                <div class="form-group">
                  <label class="form-label" for="input-card-back">Back (Answer)</label>
                  <textarea class="form-input form-textarea" id="input-card-back" rows="3" placeholder="The Mitochondria"></textarea>
                </div>
              </div>

              <!-- Cloze Deletion Fields -->
              <div class="card-type-section hidden" id="section-cloze">
                <div class="cloze-toolbar">
                  <span class="cloze-tip">Highlight text to create cloze:</span>
                  <div style="display: flex; gap: 0.5rem; flex-wrap: wrap;">
                    <button type="button" class="btn btn-secondary btn-xs" id="btn-insert-cloze-new" title="Create a new deletion card (c1, c2, c3...)">
                      [ ... ] New Cloze (c1, c2...)
                    </button>
                    <button type="button" class="btn btn-outline btn-xs" id="btn-insert-cloze-same" title="Create deletion with same number to test/reveal together">
                      [ ... ] Same Number
                    </button>
                  </div>
                </div>
                <div class="form-group">
                  <label class="form-label" for="input-cloze-text">Cloze Text</label>
                  <textarea class="form-input form-textarea" id="input-cloze-text" rows="4" placeholder="Photosynthesis occurs in the {{c1::chloroplasts}} using {{c2::sunlight}}. Use {{c1::same number}} to group blanks together."></textarea>
                </div>

                <!-- Cloze Review Mode Options -->
                <div class="form-group" style="margin-top: 10px;">
                  <label class="form-label">Cloze Review Mode</label>
                  <div class="occ-mode-selector-group">
                    <label class="occ-mode-option">
                      <input type="radio" name="input-cloze-mode" value="hide_all_guess_one" checked/>
                      <div class="occ-mode-card">
                        <span class="occ-mode-title">Hide All, Guess One</span>
                        <span class="occ-mode-desc">All blanks are hidden [...]. Tests one cloze number at a time (Card 1 tests c1, Card 2 tests c2).</span>
                      </div>
                    </label>
                    <label class="occ-mode-option">
                      <input type="radio" name="input-cloze-mode" value="hide_all_guess_all"/>
                      <div class="occ-mode-card">
                        <span class="occ-mode-title">Hide All, Guess All</span>
                        <span class="occ-mode-desc">All blanks are hidden at once on a single card. Recall all missing words together.</span>
                      </div>
                    </label>
                    <label class="occ-mode-option">
                      <input type="radio" name="input-cloze-mode" value="hide_one_guess_one"/>
                      <div class="occ-mode-card">
                        <span class="occ-mode-title">Hide One, Guess One</span>
                        <span class="occ-mode-desc">Only the tested blank is hidden; other blanks remain visible as context hints.</span>
                      </div>
                    </label>
                  </div>
                </div>

                <div class="form-group">
                  <label class="form-label" for="input-cloze-extra">Extra Notes / Back (Optional)</label>
                  <textarea class="form-input form-textarea" id="input-cloze-extra" rows="2" placeholder="Additional explanation or context"></textarea>
                </div>
              </div>

              <!-- Image Card Fields -->
              <div class="card-type-section hidden" id="section-image">
                <div class="form-group">
                  <label class="form-label" for="input-image-front">Question / Prompt</label>
                  <input type="text" class="form-input" id="input-image-front" placeholder="Identify this organelle or landmark"/>
                </div>

                <div class="form-group">
                  <label class="form-label">Upload or Paste Image</label>
                  <div class="image-upload-zone" id="image-upload-dropzone">
                    <input type="file" id="input-image-file" accept="image/*" class="file-input-hidden"/>
                    <div class="upload-zone-content">
                      <span class="upload-icon">📁</span>
                      <span>Click to browse, or paste image (Ctrl+V)</span>
                    </div>
                  </div>
                  <div class="image-url-row" style="margin-top: 8px;">
                    <input type="url" class="form-input" id="input-image-url" placeholder="Or paste image URL (https://...)"/>
                  </div>
                  <div id="image-preview-box" class="image-preview-container hidden"></div>
                </div>

                <div class="form-group">
                  <label class="form-label" for="input-image-back">Answer</label>
                  <textarea class="form-input form-textarea" id="input-image-back" rows="2" placeholder="The correct answer"></textarea>
                </div>
              </div>

              <!-- Image Occlusion Fields -->
              <div class="card-type-section hidden" id="section-occlusion">
                <div class="form-group">
                  <label class="form-label" for="input-occ-title">Card Title / Question</label>
                  <input type="text" class="form-input" id="input-occ-title" placeholder="Cell diagram: identify labeled organelles"/>
                </div>

                <div class="form-group">
                  <label class="form-label">Occlusion Diagram Image</label>
                  <div class="image-upload-zone" id="occ-upload-dropzone">
                    <input type="file" id="input-occ-file" accept="image/*" class="file-input-hidden"/>
                    <div class="upload-zone-content">
                      <span class="upload-icon">🖼️</span>
                      <span>Click to upload diagram, or paste image (Ctrl+V)</span>
                    </div>
                  </div>
                  <div class="image-url-row" style="margin-top: 8px;">
                    <input type="url" class="form-input" id="input-occ-url" placeholder="Or enter diagram image URL"/>
                  </div>
                </div>

                <!-- Occlusion Review Mode Options -->
                <div class="form-group" style="margin-top: 10px;">
                  <label class="form-label">Occlusion Review Mode</label>
                  <div class="occ-mode-selector-group">
                    <label class="occ-mode-option">
                      <input type="radio" name="input-occ-mode" value="hide_all_guess_one" checked/>
                      <div class="occ-mode-card">
                        <span class="occ-mode-title">Hide All, Guess One</span>
                        <span class="occ-mode-desc">All labels covered. Test one target label marked with ?</span>
                      </div>
                    </label>
                    <label class="occ-mode-option">
                      <input type="radio" name="input-occ-mode" value="hide_all_guess_all"/>
                      <div class="occ-mode-card">
                        <span class="occ-mode-title">Hide All, Guess All</span>
                        <span class="occ-mode-desc">All labels covered. Recall all diagram labels at once.</span>
                      </div>
                    </label>
                    <label class="occ-mode-option">
                      <input type="radio" name="input-occ-mode" value="hide_one_guess_one"/>
                      <div class="occ-mode-card">
                        <span class="occ-mode-title">Hide One, Guess One</span>
                        <span class="occ-mode-desc">Only target is covered. Other diagram labels stay visible as hints.</span>
                      </div>
                    </label>
                  </div>
                </div>

                <!-- Occlusion Canvas Canvas Area -->
                <div id="occlusion-editor-container" class="occlusion-canvas-outer hidden">
                  <div class="occlusion-toolbar" style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 0.5rem; margin-bottom: 0.75rem;">
                    <div>
                      <span class="occlusion-helper" style="font-weight: 700;">Drag to draw occlusion boxes:</span>
                      <span id="occ-box-count-badge" class="badge badge-neutral" style="margin-left: 0.5rem;">0 boxes</span>
                    </div>
                    <div style="display: flex; gap: 0.5rem;">
                      <button type="button" class="btn btn-outline btn-xs" id="btn-delete-occ-box" disabled>
                        🗑️ Delete Selected
                      </button>
                      <button type="button" class="btn btn-ghost btn-xs text-danger" id="btn-clear-all-occ-boxes">
                        Clear All
                      </button>
                    </div>
                  </div>
                  
                  <div id="occlusion-canvas-mount"></div>
                </div>
              </div>
            </div>

            <!-- Hint & Tags -->
            <div class="form-row-2" style="margin-top: 14px;">
              <div class="form-group">
                <label class="form-label" for="input-card-hint">Hint (Optional)</label>
                <input type="text" class="form-input" id="input-card-hint" placeholder="Helpful hint without giving away the answer"/>
              </div>

              <div class="form-group">
                <label class="form-label" for="input-card-tags">Tags (comma separated)</label>
                <input type="text" class="form-input" id="input-card-tags" placeholder="biology, exam-prep"/>
              </div>
            </div>

            <div class="modal-footer">
              <button type="button" class="btn btn-secondary" id="btn-cancel-card">Cancel</button>
              <button type="submit" class="btn btn-primary" id="btn-save-card">Save Flashcard</button>
            </div>
          </form>
        </div>
      </div>
    `;

    document.body.appendChild(this.modalEl);
    this._attachEvents();
  }

  async open(options = {}) {
    this.currentCard = options.card || null;
    const groups = await storage.getGroups();
    this._populateGroupSelect(groups, options.defaultGroupId || (this.currentCard ? this.currentCard.groupId : null));

    const titleEl = this.modalEl.querySelector('#card-editor-title');
    titleEl.textContent = this.currentCard ? 'Edit Flashcard' : 'Create Flashcard';

    // Populate data
    if (this.currentCard) {
      this.activeType = this.currentCard.type || CARD_TYPES.BASIC;
      this._populateCardData(this.currentCard);
    } else {
      this.activeType = CARD_TYPES.BASIC;
      this._resetForm();
    }

    this._switchTypeTab(this.activeType);
    this.modalEl.classList.remove('hidden');
  }

  close() {
    this.modalEl.classList.add('hidden');
    this.currentCard = null;
  }

  _populateGroupSelect(groups, selectedId) {
    const select = this.modalEl.querySelector('#card-group-select');
    select.innerHTML = '';

    // Build indented tree options
    const groupMap = new Map(groups.map(g => [g.id, { ...g, children: [] }]));
    const roots = [];
    for (const g of groupMap.values()) {
      if (g.parentId && groupMap.has(g.parentId)) {
        groupMap.get(g.parentId).children.push(g);
      } else {
        roots.push(g);
      }
    }

    const appendOptions = (nodes, depth) => {
      for (const node of nodes) {
        const opt = document.createElement('option');
        opt.value = node.id;
        const prefix = depth > 0 ? '— '.repeat(depth) : '';
        opt.textContent = `${prefix}${node.name} (${node.type || 'folder'})`;
        if (node.id === selectedId) opt.selected = true;
        select.appendChild(opt);

        if (node.children && node.children.length > 0) {
          appendOptions(node.children, depth + 1);
        }
      }
    };

    appendOptions(roots, 0);
  }

  _switchTypeTab(type) {
    this.activeType = type;
    this.modalEl.querySelectorAll('.pill-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.type === type);
    });

    const secBasic = this.modalEl.querySelector('#section-basic');
    const secCloze = this.modalEl.querySelector('#section-cloze');
    const secImage = this.modalEl.querySelector('#section-image');
    const secOcc = this.modalEl.querySelector('#section-occlusion');

    secBasic.classList.toggle('hidden', type !== CARD_TYPES.BASIC && type !== CARD_TYPES.REVERSIBLE);
    secCloze.classList.toggle('hidden', type !== CARD_TYPES.CLOZE);
    secImage.classList.toggle('hidden', type !== CARD_TYPES.IMAGE);
    secOcc.classList.toggle('hidden', type !== CARD_TYPES.IMAGE_OCCLUSION);
  }

  _populateCardData(card) {
    this.modalEl.querySelector('#input-card-front').value = card.front || '';
    this.modalEl.querySelector('#input-card-back').value = card.back || '';
    this.modalEl.querySelector('#input-cloze-text').value = card.clozeText || card.front || '';
    this.modalEl.querySelector('#input-cloze-extra').value = card.back || '';
    this.modalEl.querySelector('#input-image-front').value = card.front || '';
    this.modalEl.querySelector('#input-image-back').value = card.back || '';
    this.modalEl.querySelector('#input-image-url').value = card.imageUrl || '';
    this.modalEl.querySelector('#input-occ-title').value = card.front || '';
    this.modalEl.querySelector('#input-occ-url').value = card.imageUrl || '';
    this.modalEl.querySelector('#input-card-hint').value = card.hint || '';
    this.modalEl.querySelector('#input-card-tags').value = (card.tags || []).join(', ');

    const occMode = card.occlusionMode || 'hide_all_guess_one';
    const occRadio = this.modalEl.querySelector(`input[name="input-occ-mode"][value="${occMode}"]`);
    if (occRadio) occRadio.checked = true;

    const clozeMode = card.clozeMode || 'hide_all_guess_one';
    const clozeRadio = this.modalEl.querySelector(`input[name="input-cloze-mode"][value="${clozeMode}"]`);
    if (clozeRadio) clozeRadio.checked = true;

    if (card.imageUrl && card.type === CARD_TYPES.IMAGE) {
      this._renderImagePreview(card.imageUrl);
    }

    if (card.imageUrl && card.type === CARD_TYPES.IMAGE_OCCLUSION) {
      this._initOcclusionEditor(card.imageUrl, card.imageOcclusions || []);
    }
  }

  _resetForm() {
    this.modalEl.querySelector('#card-editor-form').reset();
    const defaultOccRadio = this.modalEl.querySelector('input[name="input-occ-mode"][value="hide_all_guess_one"]');
    if (defaultOccRadio) defaultOccRadio.checked = true;
    const defaultClozeRadio = this.modalEl.querySelector('input[name="input-cloze-mode"][value="hide_all_guess_one"]');
    if (defaultClozeRadio) defaultClozeRadio.checked = true;
    this.modalEl.querySelector('#image-preview-box').classList.add('hidden');
    this.modalEl.querySelector('#occlusion-editor-container').classList.add('hidden');
    this.occlusionEditor = null;
  }

  _renderImagePreview(url) {
    const preview = this.modalEl.querySelector('#image-preview-box');
    preview.innerHTML = `<img src="${url}" alt="Preview" style="max-height: 180px; border-radius: 6px;"/>`;
    preview.classList.remove('hidden');
  }

  _initOcclusionEditor(url, initialBoxes = []) {
    if (this.occlusionEditor) {
      this.occlusionEditor.destroy();
    }

    const container = this.modalEl.querySelector('#occlusion-canvas-mount');
    const outer = this.modalEl.querySelector('#occlusion-editor-container');
    outer.classList.remove('hidden');

    const btnDelete = this.modalEl.querySelector('#btn-delete-occ-box');
    const btnClearAll = this.modalEl.querySelector('#btn-clear-all-occ-boxes');
    const countBadge = this.modalEl.querySelector('#occ-box-count-badge');

    const updateBadge = (count) => {
      if (countBadge) {
        countBadge.textContent = `${count} ${count === 1 ? 'box' : 'boxes'}`;
        countBadge.className = count > 0 ? 'badge badge-due' : 'badge badge-neutral';
      }
    };

    updateBadge(initialBoxes.length);

    this.occlusionEditor = new OcclusionEditor(container, {
      imageUrl: url,
      initialBoxes,
      onChange: (boxes, selectedBoxId) => {
        updateBadge(boxes.length);
        if (btnDelete) btnDelete.disabled = !selectedBoxId;
      }
    });

    if (btnDelete) {
      btnDelete.onclick = () => {
        if (this.occlusionEditor) this.occlusionEditor.deleteSelectedBox();
      };
    }

    if (btnClearAll) {
      btnClearAll.onclick = () => {
        if (this.occlusionEditor && confirm('Clear all occlusion boxes from this image?')) {
          this.occlusionEditor.setBoxes([]);
          updateBadge(0);
          if (btnDelete) btnDelete.disabled = true;
        }
      };
    }
  }

  _attachEvents() {
    this.modalEl.querySelector('#btn-close-card-editor').onclick = () => this.close();
    this.modalEl.querySelector('#btn-cancel-card').onclick = () => this.close();

    // Type pills
    this.modalEl.querySelectorAll('.pill-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this._switchTypeTab(btn.dataset.type);
      });
    });

    // Cloze shortcut buttons & keyboard shortcuts
    const textareaCloze = this.modalEl.querySelector('#input-cloze-text');
    const insertClozeTag = (useNewNumber) => {
      const start = textareaCloze.selectionStart;
      const end = textareaCloze.selectionEnd;
      const val = textareaCloze.value;
      const selected = val.substring(start, end) || 'text';

      const nums = getClozeNumbers(val);
      let clozeNum = 1;
      if (nums.length > 0) {
        const maxNum = Math.max(...nums);
        clozeNum = useNewNumber ? maxNum + 1 : maxNum;
      }

      const replacement = `{{c${clozeNum}::${selected}}}`;
      textareaCloze.value = val.substring(0, start) + replacement + val.substring(end);
      textareaCloze.focus();

      // Highlight the inserted inner text
      const newStart = start + `{{c${clozeNum}::`.length;
      const newEnd = newStart + selected.length;
      textareaCloze.setSelectionRange(newStart, newEnd);
    };

    const btnClozeNew = this.modalEl.querySelector('#btn-insert-cloze-new');
    const btnClozeSame = this.modalEl.querySelector('#btn-insert-cloze-same');
    if (btnClozeNew) btnClozeNew.onclick = () => insertClozeTag(true);
    if (btnClozeSame) btnClozeSame.onclick = () => insertClozeTag(false);

    if (textareaCloze) {
      textareaCloze.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'c') {
          e.preventDefault();
          insertClozeTag(true);
        } else if (e.altKey && e.shiftKey && e.key.toLowerCase() === 'c') {
          e.preventDefault();
          insertClozeTag(false);
        }
      });
    }

    // Standard Image Dropzone & File Pick
    const dropzone = this.modalEl.querySelector('#image-upload-dropzone');
    const fileInput = this.modalEl.querySelector('#input-image-file');
    const urlInput = this.modalEl.querySelector('#input-image-url');

    dropzone.onclick = () => fileInput.click();
    fileInput.onchange = (e) => {
      const file = e.target.files[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = (event) => {
          urlInput.value = event.target.result;
          this._renderImagePreview(event.target.result);
        };
        reader.readAsDataURL(file);
      }
    };
    urlInput.oninput = (e) => {
      if (e.target.value) this._renderImagePreview(e.target.value);
    };

    // Occlusion Dropzone & File Pick
    const occDropzone = this.modalEl.querySelector('#occ-upload-dropzone');
    const occFileInput = this.modalEl.querySelector('#input-occ-file');
    const occUrlInput = this.modalEl.querySelector('#input-occ-url');

    occDropzone.onclick = () => occFileInput.click();
    occFileInput.onchange = (e) => {
      const file = e.target.files[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = (event) => {
          occUrlInput.value = event.target.result;
          this._initOcclusionEditor(event.target.result, []);
        };
        reader.readAsDataURL(file);
      }
    };
    occUrlInput.oninput = (e) => {
      if (e.target.value) {
        this._initOcclusionEditor(e.target.value, []);
      }
    };

    // Paste handler for images
    window.addEventListener('paste', (e) => {
      if (this.modalEl.classList.contains('hidden')) return;
      const items = (e.clipboardData || e.originalEvent.clipboardData).items;
      for (const item of items) {
        if (item.type.indexOf('image') !== -1) {
          const blob = item.getAsFile();
          const reader = new FileReader();
          reader.onload = (event) => {
            if (this.activeType === CARD_TYPES.IMAGE_OCCLUSION) {
              occUrlInput.value = event.target.result;
              this._initOcclusionEditor(event.target.result, []);
            } else if (this.activeType === CARD_TYPES.IMAGE) {
              urlInput.value = event.target.result;
              this._renderImagePreview(event.target.result);
            }
          };
          reader.readAsDataURL(blob);
          break;
        }
      }
    });

    // Form submit
    this.modalEl.querySelector('#card-editor-form').onsubmit = async (e) => {
      e.preventDefault();
      await this._handleSave();
    };
  }

  async _handleSave() {
    const groupId = this.modalEl.querySelector('#card-group-select').value;
    const hint = this.modalEl.querySelector('#input-card-hint').value.trim();
    const tagsStr = this.modalEl.querySelector('#input-card-tags').value.trim();
    const tags = tagsStr ? tagsStr.split(',').map(t => t.trim()).filter(Boolean) : [];

    let front = '';
    let back = '';
    let clozeText = '';
    let imageUrl = '';
    let imageOcclusions = [];

    let clozeMode = OCCLUSION_MODES.HIDE_ALL_GUESS_ONE;

    if (this.activeType === CARD_TYPES.BASIC || this.activeType === CARD_TYPES.REVERSIBLE) {
      front = this.modalEl.querySelector('#input-card-front').value.trim();
      back = this.modalEl.querySelector('#input-card-back').value.trim();
      if (!front || !back) {
        alert('Please fill in both the Front and Back fields.');
        return;
      }
    } else if (this.activeType === CARD_TYPES.CLOZE) {
      clozeText = this.modalEl.querySelector('#input-cloze-text').value.trim();
      back = this.modalEl.querySelector('#input-cloze-extra').value.trim();
      front = 'Cloze: ' + clozeText.substring(0, 40) + '...';
      if (!clozeText) {
        alert('Please enter text for the cloze card.');
        return;
      }
      const clozeRadio = this.modalEl.querySelector('input[name="input-cloze-mode"]:checked');
      if (clozeRadio) clozeMode = clozeRadio.value;
    } else if (this.activeType === CARD_TYPES.IMAGE) {
      front = this.modalEl.querySelector('#input-image-front').value.trim();
      back = this.modalEl.querySelector('#input-image-back').value.trim();
      imageUrl = this.modalEl.querySelector('#input-image-url').value.trim();
      if (!imageUrl || !back) {
        alert('Please provide an image and the answer.');
        return;
      }
    }

    let occlusionMode = 'hide_all_guess_one';
    if (this.activeType === CARD_TYPES.IMAGE_OCCLUSION) {
      front = this.modalEl.querySelector('#input-occ-title').value.trim() || 'Identify diagram labels';
      imageUrl = this.modalEl.querySelector('#input-occ-url').value.trim();
      if (!imageUrl) {
        alert('Please upload or provide an image for the occlusion card.');
        return;
      }
      imageOcclusions = this.occlusionEditor ? this.occlusionEditor.getBoxes() : [];
      if (imageOcclusions.length === 0) {
        alert('Please draw at least one occlusion box over the image diagram.');
        return;
      }
      const modeRadio = this.modalEl.querySelector('input[name="input-occ-mode"]:checked');
      if (modeRadio) occlusionMode = modeRadio.value;
      back = '';
    }

    const cardData = {
      ...(this.currentCard || {}),
      groupId,
      type: this.activeType,
      front,
      back,
      hint,
      clozeText,
      clozeMode,
      clozeSrs: this.currentCard ? this.currentCard.clozeSrs : {},
      imageUrl,
      imageOcclusions,
      occlusionMode,
      boxSrs: this.currentCard ? this.currentCard.boxSrs : {},
      tags
    };

    const saved = createCard(cardData);
    await storage.saveCard(saved);

    this.close();
    window.dispatchEvent(new CustomEvent('card-saved', { detail: { card: saved } }));
  }
}
