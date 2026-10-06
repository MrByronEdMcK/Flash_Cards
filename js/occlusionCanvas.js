/**
 * Image Occlusion Canvas & Viewer
 * Handles drawing, editing, and interactive review of occlusion boxes on top of images.
 * Coordinates are normalized to percentages (0-100%) for pixel-perfect responsive scaling.
 */

export class OcclusionEditor {
  constructor(containerEl, options = {}) {
    this.container = containerEl;
    this.options = options;
    this.image = null;
    this.boxes = options.initialBoxes ? JSON.parse(JSON.stringify(options.initialBoxes)) : [];
    this.selectedBoxId = null;
    this.isDrawing = false;
    this.startX = 0;
    this.startY = 0;
    this.currentBox = null;
    this.onChange = options.onChange || (() => {});

    this._onMouseMove = this._handleMouseMove.bind(this);
    this._onMouseUp = this._handleMouseUp.bind(this);

    this._setupDOM();
    this._attachEvents();

    if (options.imageUrl) {
      this.loadImage(options.imageUrl);
    }
  }

  _setupDOM() {
    this.container.innerHTML = `
      <div class="occlusion-editor-wrapper" style="text-align: center;">
        <div class="occlusion-canvas-stage" style="position: relative; display: inline-block; max-width: 100%; line-height: 0; margin: 0 auto; border: 1px solid var(--border-color); border-radius: 8px; overflow: hidden; background: #0000000a;">
          <img class="occlusion-source-img" style="display: block; max-width: 100%; max-height: 480px; width: auto; height: auto; user-select: none;" alt="Occlusion Diagram"/>
          <svg class="occlusion-overlay-svg" style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; cursor: crosshair; user-select: none;"></svg>
        </div>
      </div>
    `;

    this.imgEl = this.container.querySelector('.occlusion-source-img');
    this.svgEl = this.container.querySelector('.occlusion-overlay-svg');
  }

  loadImage(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        this.image = img;
        this.imgEl.src = url;
        // Wait for next frame for layout to settle
        requestAnimationFrame(() => {
          this.renderSvg();
          resolve();
        });
      };
      img.onerror = reject;
      img.src = url;
    });
  }

  setBoxes(boxes) {
    this.boxes = JSON.parse(JSON.stringify(boxes || []));
    this.selectedBoxId = null;
    this.renderSvg();
  }

  getBoxes() {
    return this.boxes;
  }

  destroy() {
    window.removeEventListener('mousemove', this._onMouseMove);
    window.removeEventListener('mouseup', this._onMouseUp);
  }

  _getCoords(e) {
    const rect = this.svgEl.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    const xPct = Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100));
    const yPct = Math.max(0, Math.min(100, ((clientY - rect.top) / rect.height) * 100));
    return { xPct, yPct };
  }

  _attachEvents() {
    this.svgEl.addEventListener('mousedown', (e) => {
      // Check if clicking on an existing box
      const targetGroup = e.target.closest('.occ-box-group');
      if (targetGroup && targetGroup.dataset.boxId) {
        e.stopPropagation();
        this.selectBox(targetGroup.dataset.boxId);
        return;
      }

      this.isDrawing = true;
      const { xPct, yPct } = this._getCoords(e);
      this.startX = xPct;
      this.startY = yPct;
      this.currentBox = {
        id: `box_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        x: xPct,
        y: yPct,
        width: 0,
        height: 0,
        label: ''
      };
    });

    window.addEventListener('mousemove', this._onMouseMove);
    window.addEventListener('mouseup', this._onMouseUp);
  }

  _handleMouseMove(e) {
    if (!this.isDrawing || !this.currentBox) return;
    const { xPct, yPct } = this._getCoords(e);
    const x = Math.min(this.startX, xPct);
    const y = Math.min(this.startY, yPct);
    const width = Math.abs(xPct - this.startX);
    const height = Math.abs(yPct - this.startY);

    this.currentBox.x = x;
    this.currentBox.y = y;
    this.currentBox.width = width;
    this.currentBox.height = height;

    this.renderSvg();
  }

  _handleMouseUp() {
    if (!this.isDrawing) return;
    this.isDrawing = false;
    if (this.currentBox && this.currentBox.width > 2 && this.currentBox.height > 2) {
      this.currentBox.x = Number(this.currentBox.x.toFixed(2));
      this.currentBox.y = Number(this.currentBox.y.toFixed(2));
      this.currentBox.width = Number(this.currentBox.width.toFixed(2));
      this.currentBox.height = Number(this.currentBox.height.toFixed(2));
      this.boxes.push(this.currentBox);
      this.selectedBoxId = this.currentBox.id;
      this.onChange(this.boxes, this.selectedBoxId);
    }
    this.currentBox = null;
    this.renderSvg();
  }

  selectBox(boxId) {
    this.selectedBoxId = boxId;
    this.renderSvg();
    this.onChange(this.boxes, this.selectedBoxId);
  }

  deleteSelectedBox() {
    if (!this.selectedBoxId) return;
    this.boxes = this.boxes.filter(b => b.id !== this.selectedBoxId);
    this.selectedBoxId = null;
    this.renderSvg();
    this.onChange(this.boxes, null);
  }

  updateSelectedBoxLabel(label) {
    const box = this.boxes.find(b => b.id === this.selectedBoxId);
    if (box) {
      box.label = label;
      this.renderSvg();
      this.onChange(this.boxes, this.selectedBoxId);
    }
  }

  renderSvg() {
    let svgContent = '';
    const allBoxes = [...this.boxes];
    if (this.currentBox) allBoxes.push(this.currentBox);

    allBoxes.forEach((box, index) => {
      const isSelected = box.id === this.selectedBoxId;
      const strokeColor = isSelected ? '#b83a3a' : 'var(--primary)';
      const fillColor = isSelected ? 'rgba(184, 58, 58, 0.45)' : 'var(--primary-light)';
      const boxNum = index + 1;

      svgContent += `
        <g class="occ-box-group" data-box-id="${box.id}" style="cursor: pointer;">
          <rect
            x="${box.x}%"
            y="${box.y}%"
            width="${box.width}%"
            height="${box.height}%"
            fill="${fillColor}"
            stroke="${strokeColor}"
            stroke-width="${isSelected ? '2.5' : '1.5'}"
            stroke-dasharray="${isSelected ? '4,2' : 'none'}"
            rx="4"
            data-box-id="${box.id}"
          />
          <!-- Badge tag showing Box # in corner -->
          <rect
            x="${box.x}%"
            y="${box.y}%"
            width="20"
            height="15"
            fill="${strokeColor}"
            rx="3"
            pointer-events="none"
          />
          <text
            x="${box.x}%"
            dx="10"
            y="${box.y}%"
            dy="11"
            fill="#ffffff"
            font-size="11px"
            font-family="system-ui, sans-serif"
            font-weight="bold"
            text-anchor="middle"
            pointer-events="none"
          >${boxNum}</text>
        </g>
      `;
    });

    this.svgEl.innerHTML = svgContent;
  }
}

/**
 * Occlusion Viewer for Study Mode
 * Responsive diagram container that NEVER overflows or clips images.
 * Supports:
 *  1. 'hide_all_guess_one' (Default): All boxes masked on front, target box has ?; answer reveals target.
 *  2. 'hide_all_guess_all': All boxes masked on front; answer reveals all boxes simultaneously.
 *  3. 'hide_one_guess_one': Only target box is masked on front; other diagram labels stay visible.
 */
export function renderOcclusionStudyViewer(card, isRevealed = false, targetIndex = 0) {
  const imageUrl = card.imageUrl;
  const boxes = card.imageOcclusions || [];
  const mode = card.occlusionMode || 'hide_all_guess_one';

  return `
    <div class="occlusion-study-container">
      <img 
        src="${imageUrl}" 
        alt="Study Diagram" 
        class="occlusion-study-image"
      />
      <div class="occlusion-study-overlay">
        ${boxes.map((box, index) => {
          const isTarget = index === targetIndex;

          let stateClass = '';
          if (mode === 'hide_one_guess_one') {
            if (!isTarget) {
              // Non-target boxes are left completely open (unmasked) so student can read surrounding context
              return '';
            }
            stateClass = isRevealed ? 'occ-box-revealed target-box' : 'occ-box-masked target-box';
          } else if (mode === 'hide_all_guess_all') {
            // All boxes masked on front, ALL revealed on back
            stateClass = isRevealed ? 'occ-box-revealed' : 'occ-box-masked';
          } else {
            // Default: hide_all_guess_one (Classic Anki)
            // On front: ALL masked. On back: ONLY the target box is revealed, others stay masked!
            if (isRevealed) {
              stateClass = isTarget ? 'occ-box-revealed target-box' : 'occ-box-masked other-box';
            } else {
              stateClass = isTarget ? 'occ-box-masked target-box' : 'occ-box-masked other-box';
            }
          }

          const isCurrentlyRevealed = stateClass.includes('occ-box-revealed');

          return `
            <div 
              class="occlusion-study-box ${stateClass}"
              data-box-index="${index}"
              data-box-id="${box.id || index}"
              style="
                left: ${box.x}%;
                top: ${box.y}%;
                width: ${box.width}%;
                height: ${box.height}%;
              "
            >
              <!-- Masked State (Front of card): target shows ?, other boxes are solid clean masks -->
              ${!isCurrentlyRevealed ? `
                <span class="occ-mask-content">
                  ${(isTarget || mode === 'hide_all_guess_all') ? '<span class="occ-qmark">?</span>' : ''}
                </span>
              ` : ''}

              <!-- Revealed State (Back of card): 100% empty & clear outline so underlying diagram is completely visible -->
            </div>
          `;
        }).join('')}
      </div>
    </div>
  `;
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
