/**
 * Hierarchical Tree View & Deck Manager
 * Supports unlimited nesting: Class -> Unit -> Lesson -> Concept -> ...
 */

import { storage } from '../storage.js';
import { isCardDue, formatInterval } from '../srs.js';
import { getCardCount, getDueCountForCard } from '../models.js';

export class TreeView {
  constructor(container, navigateTo) {
    this.container = container;
    this.navigateTo = navigateTo;
    this.selectedGroupId = null;
    this.expandedGroupIds = new Set();
    this.draggedGroupId = null;
    this.descendantsOfDragged = null;
    this.dragHoverExpandTimer = null;
  }

  async render(options = {}) {
    if (options.focusGroupId) {
      this.selectedGroupId = options.focusGroupId;
      this.expandedGroupIds.add(options.focusGroupId);
    }

    const groups = await storage.getGroups();
    const cards = await storage.getCards();

    // If no group selected, select first root group or null
    if (!this.selectedGroupId && groups.length > 0) {
      this.selectedGroupId = groups[0].id;
      this.expandedGroupIds.add(groups[0].id);
    }

    // Build hierarchy with order-awareness
    const sortedGroups = [...groups].sort((a, b) => {
      const orderA = typeof a.order === 'number' ? a.order : 0;
      const orderB = typeof b.order === 'number' ? b.order : 0;
      if (orderA !== orderB) return orderA - orderB;
      return (a.createdAt || '').localeCompare(b.createdAt || '');
    });

    const groupMap = new Map(sortedGroups.map(g => [g.id, { ...g, children: [] }]));
    const rootGroups = [];

    for (const group of groupMap.values()) {
      if (group.parentId && groupMap.has(group.parentId)) {
        groupMap.get(group.parentId).children.push(group);
      } else {
        rootGroups.push(group);
      }
    }

    for (const group of groupMap.values()) {
      group.children.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    }
    rootGroups.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

    // Calculate card counts (including subtree)
    const cardCounts = {};
    const dueCounts = {};
    for (const group of groups) {
      const subIds = await storage.getSubgroupIds(group.id);
      subIds.add(group.id);
      const groupCards = cards.filter(c => subIds.has(c.groupId));
      cardCounts[group.id] = groupCards.reduce((sum, c) => sum + getCardCount(c), 0);
      dueCounts[group.id] = groupCards.reduce((sum, c) => sum + getDueCountForCard(c), 0);
    }

    const activeGroup = groups.find(g => g.id === this.selectedGroupId);

    // Get all cards in the selected group AND all its nested sub-folders
    const subgroupIds = activeGroup ? await storage.getSubgroupIds(activeGroup.id) : new Set();
    const allRelevantGroupIds = new Set(activeGroup ? [activeGroup.id, ...subgroupIds] : []);
    const subtreeCards = cards.filter(c => allRelevantGroupIds.has(c.groupId));
    const directCards = activeGroup ? cards.filter(c => c.groupId === activeGroup.id) : [];

    // Group cards that belong to sub-folders
    const subgroupCardsMap = new Map();
    for (const card of subtreeCards) {
      if (card.groupId !== activeGroup.id) {
        if (!subgroupCardsMap.has(card.groupId)) {
          subgroupCardsMap.set(card.groupId, []);
        }
        subgroupCardsMap.get(card.groupId).push(card);
      }
    }

    const totalReviewCards = subtreeCards.reduce((sum, c) => sum + getCardCount(c), 0);
    const countBadgeText = totalReviewCards > subtreeCards.length
      ? `${subtreeCards.length} flashcards (${totalReviewCards} review cards)`
      : `${subtreeCards.length} ${subtreeCards.length === 1 ? 'card' : 'cards'}`;

    this.container.innerHTML = `
      <div class="deck-manager-layout animate-fade-in">
        <!-- Left Sidebar: Hierarchical Tree Navigator -->
        <aside class="tree-sidebar">
          <div class="tree-sidebar-header">
            <div>
              <h3>Folder Hierarchy</h3>
              <span class="tree-header-hint" style="font-size: 0.72rem; color: var(--text-muted); display: block; margin-top: 2px;">
                Drag &amp; drop to reorganise
              </span>
            </div>
            <button class="btn btn-primary btn-xs" id="btn-add-root-group" title="Add New Class/Subject">
              + Add Class
            </button>
          </div>

          <div class="tree-nodes-container">
            ${rootGroups.length === 0 ? `
              <div class="empty-tree-state">
                <p>No classes or decks yet.</p>
                <button class="btn btn-outline btn-sm" id="btn-seed-sample">Load Sample Decks</button>
              </div>
            ` : `
              ${this._renderTreeNodes(rootGroups, cardCounts, dueCounts, 0)}
              <div class="tree-root-dropzone" data-drop-root="true" title="Drag any folder here to move it to the top level (Class)">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 10 4 15 9 20"></polyline><path d="M20 4v7a4 4 0 0 1-4 4H4"></path></svg>
                <span>Move to top level (Class)</span>
              </div>
            `}
          </div>
        </aside>

        <!-- Right Main: Selected Group Content & Cards List -->
        <main class="tree-main-content">
          ${activeGroup ? this._renderActiveGroupHeader(activeGroup, cardCounts, dueCounts) : `
            <div class="empty-selection-placeholder">
              <h3>Select a group from the left to view cards and start studying.</h3>
            </div>
          `}

          <!-- Cards in Selected Group -->
          <div class="cards-list-section">
            <div class="cards-list-header">
              <div>
                <h4>Cards in this folder (${countBadgeText})</h4>
                ${subgroupCardsMap.size > 0 ? `
                  <p class="cards-list-subtitle" style="font-size: 0.82rem; color: var(--text-muted); margin-top: 2px;">
                    Showing cards from this folder and all nested sub-folders.
                  </p>
                ` : ''}
              </div>
              <button class="btn btn-primary btn-sm" id="btn-add-card-to-group">
                + Add Card Here
              </button>
            </div>

            ${this._renderCardsListContent(activeGroup, subtreeCards, directCards, subgroupCardsMap, groupMap)}
          </div>
        </main>
      </div>
    `;

    this._attachEventListeners(groups);
  }

  _renderTreeNodes(nodes, cardCounts, dueCounts, depth) {
    return `
      <ul class="tree-ul depth-${depth}">
        ${nodes.map(node => {
          const isSelected = node.id === this.selectedGroupId;
          const isExpanded = this.expandedGroupIds.has(node.id);
          const hasChildren = node.children && node.children.length > 0;
          const totalCards = cardCounts[node.id] || 0;
          const dueCards = dueCounts[node.id] || 0;

          return `
            <li class="tree-node-item" data-group-id="${node.id}">
              <div class="tree-node-row ${isSelected ? 'selected' : ''}" 
                   draggable="true" 
                   data-drag-id="${node.id}">
                <span class="tree-drag-handle" title="Drag to reorganise folder" aria-label="Drag handle">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
                    <circle cx="9" cy="6" r="2.2"></circle>
                    <circle cx="15" cy="6" r="2.2"></circle>
                    <circle cx="9" cy="12" r="2.2"></circle>
                    <circle cx="15" cy="12" r="2.2"></circle>
                    <circle cx="9" cy="18" r="2.2"></circle>
                    <circle cx="15" cy="18" r="2.2"></circle>
                  </svg>
                </span>
                <button class="tree-expand-btn ${hasChildren ? '' : 'invisible'}" data-toggle-id="${node.id}" title="${isExpanded ? 'Collapse' : 'Expand'}">
                  ${isExpanded ? '▼' : '▶'}
                </button>
                
                <div class="tree-node-title" data-select-id="${node.id}">
                  <span class="tree-type-pill pill-${node.type || 'custom'}">${(node.type || 'group').toUpperCase()}</span>
                  <span class="tree-node-name">${escapeHtml(node.name)}</span>
                </div>

                <div class="tree-node-badges">
                  ${dueCards > 0 ? `<span class="badge badge-due">${dueCards} due</span>` : ''}
                  <span class="badge badge-neutral">${totalCards}</span>
                </div>
              </div>

              ${hasChildren && isExpanded ? this._renderTreeNodes(node.children, cardCounts, dueCounts, depth + 1) : ''}
            </li>
          `;
        }).join('')}
      </ul>
    `;
  }

  _renderActiveGroupHeader(group, cardCounts, dueCounts) {
    const totalCards = cardCounts[group.id] || 0;
    const dueCards = dueCounts[group.id] || 0;

    return `
      <div class="group-detail-header">
        <div class="group-detail-meta">
          <span class="group-tag-type">${(group.type || 'group').toUpperCase()}</span>
          <h2 class="group-title">${escapeHtml(group.name)}</h2>
          <div class="group-counts">
            <span><strong>${totalCards}</strong> total cards (including sub-folders)</span>
            <span>•</span>
            <span class="${dueCards > 0 ? 'text-due' : 'text-neutral'}"><strong>${dueCards}</strong> due for daily review</span>
          </div>
        </div>

        <div class="group-action-buttons">
          <button class="btn btn-primary" id="btn-study-group-daily" ${dueCards === 0 ? 'disabled' : ''}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
            Daily Review (${dueCards})
          </button>
          <button class="btn btn-outline" id="btn-study-group-endless" ${totalCards === 0 ? 'disabled' : ''}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18.178 8c5.096 0 5.096 8 0 8-5.095 0-7.133-8-12.739-8-4.585 0-4.585 8 0 8 5.606 0 7.644-8 12.739-8z"></path></svg>
            Endless Practice
          </button>
          
          <div class="dropdown-wrapper">
            <button class="btn btn-secondary btn-icon" id="btn-group-more" title="More Options">⚙️</button>
            <div class="dropdown-menu" id="group-more-menu">
              <button class="dropdown-item" id="btn-add-subgroup">+ Add Sub-level (${this._getNextLevelName(group.type)})</button>
              <button class="dropdown-item" id="btn-export-group">📤 Export Folder (JSON)</button>
              <button class="dropdown-item" id="btn-edit-group">✏️ Rename / Edit</button>
              <div class="dropdown-divider"></div>
              <button class="dropdown-item text-danger" id="btn-delete-group">🗑️ Delete Folder</button>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  _getNextLevelName(type) {
    if (type === 'class') return 'Unit';
    if (type === 'unit') return 'Lesson';
    if (type === 'lesson') return 'Concept';
    return 'Sub-group';
  }

  _renderCardItem(card) {
    const dueCount = getDueCountForCard(card);
    const totalCount = getCardCount(card);
    const isDue = dueCount > 0;
    const intervalDisplay = formatInterval(card.srs ? card.srs.interval : 0, card.srs ? card.srs.state : 'new');

    let badgeText = isDue ? 'Due Today' : `Interval: ${intervalDisplay}`;
    if (totalCount > 1) {
      badgeText = isDue ? `${dueCount} of ${totalCount} Due` : `${totalCount} cards (Caught up)`;
    }

    let previewContent = '';
    if (card.type === 'cloze') {
      previewContent = `<div class="card-item-front">${escapeHtml(card.clozeText || card.front)}</div>`;
    } else if (card.type === 'image_occlusion') {
      previewContent = `
        <div class="card-item-front">
          <strong>[Image Occlusion Card]</strong> ${escapeHtml(card.front)}
          <div class="occ-preview-thumbnail" style="margin-top: 6px;">
            <img src="${escapeHtml(card.imageUrl)}" alt="Diagram" style="max-height: 80px; border-radius: 4px; object-fit: cover;"/>
            <span class="occ-box-count">${(card.imageOcclusions || []).length} occlusion boxes (${totalCount} review cards)</span>
          </div>
        </div>
      `;
    } else {
      previewContent = `
        <div class="card-item-front">${escapeHtml(card.front)}</div>
        <div class="card-item-back">${escapeHtml(card.back)}</div>
      `;
    }

    return `
      <div class="card-item-box" data-card-id="${card.id}">
        <div class="card-item-top">
          <span class="badge badge-card-type">${(card.type || 'basic').replace('_', ' ').toUpperCase()}</span>
          <span class="badge ${isDue ? 'badge-due' : 'badge-neutral'}">
            ${badgeText}
          </span>
        </div>

        <div class="card-item-body">
          ${previewContent}
        </div>

        <div class="card-item-actions">
          <button class="btn btn-ghost btn-xs btn-edit-card" data-card-id="${card.id}">Edit</button>
          <button class="btn btn-ghost btn-xs text-danger btn-delete-card" data-card-id="${card.id}">Delete</button>
        </div>
      </div>
    `;
  }

  _renderCardsListContent(activeGroup, subtreeCards, directCards, subgroupCardsMap, groupMap) {
    if (subtreeCards.length === 0) {
      return `
        <div class="cards-grid">
          <div class="empty-cards-state">
            <div class="empty-icon">📇</div>
            <p>No cards in this folder or its sub-folders yet.</p>
            <button class="btn btn-outline btn-sm" id="btn-add-card-empty">+ Add Your First Card</button>
          </div>
        </div>
      `;
    }

    // If there are no cards in sub-folders (all cards are directly in this group)
    if (subgroupCardsMap.size === 0) {
      return `
        <div class="cards-grid">
          ${directCards.map(card => this._renderCardItem(card)).join('')}
        </div>
      `;
    }

    // Multiple groups: render blocks with distinct subheadings!
    let html = '<div class="cards-group-blocks">';

    // Direct cards block (if any exist)
    if (directCards.length > 0) {
      const directReviewCount = directCards.reduce((sum, c) => sum + getCardCount(c), 0);
      const directCountLabel = directReviewCount > directCards.length
        ? `${directCards.length} flashcards (${directReviewCount} review cards)`
        : `${directCards.length} ${directCards.length === 1 ? 'card' : 'cards'}`;

      html += `
        <div class="cards-group-block">
          <div class="cards-subgroup-header">
            <div class="cards-subgroup-title">
              <span class="tree-type-pill pill-${activeGroup ? (activeGroup.type || 'custom') : 'custom'}">${activeGroup ? (activeGroup.type || 'folder').toUpperCase() : 'FOLDER'}</span>
              <strong>Direct cards in ${escapeHtml(activeGroup ? activeGroup.name : 'this folder')}</strong>
            </div>
            <div class="cards-subgroup-actions">
              <span class="badge badge-neutral">${directCountLabel}</span>
            </div>
          </div>
          <div class="cards-grid">
            ${directCards.map(card => this._renderCardItem(card)).join('')}
          </div>
        </div>
      `;
    }

    // Subgroup blocks
    for (const [subgroupId, subCards] of subgroupCardsMap.entries()) {
      const subgroup = groupMap.get(subgroupId);
      const breadcrumbs = this._getSubgroupBreadcrumbs(subgroupId, activeGroup ? activeGroup.id : null, groupMap);
      const subReviewCount = subCards.reduce((sum, c) => sum + getCardCount(c), 0);
      const subCountLabel = subReviewCount > subCards.length
        ? `${subCards.length} flashcards (${subReviewCount} review cards)`
        : `${subCards.length} ${subCards.length === 1 ? 'card' : 'cards'}`;

      html += `
        <div class="cards-group-block">
          <div class="cards-subgroup-header">
            <div class="cards-subgroup-title">
              <span class="tree-type-pill pill-${subgroup ? (subgroup.type || 'custom') : 'custom'}">${subgroup ? (subgroup.type || 'folder').toUpperCase() : 'FOLDER'}</span>
              <strong>${escapeHtml(breadcrumbs)}</strong>
            </div>
            <div class="cards-subgroup-actions">
              <span class="badge badge-neutral">${subCountLabel}</span>
              <button type="button" class="btn btn-ghost btn-xs btn-open-subgroup" data-group-id="${subgroupId}" title="Open this folder">
                Open Folder &rarr;
              </button>
            </div>
          </div>
          <div class="cards-grid">
            ${subCards.map(card => this._renderCardItem(card)).join('')}
          </div>
        </div>
      `;
    }

    html += '</div>';
    return html;
  }

  _getSubgroupBreadcrumbs(subgroupId, rootGroupId, groupMap) {
    const parts = [];
    let curr = groupMap.get(subgroupId);
    while (curr && curr.id !== rootGroupId) {
      parts.unshift(curr.name);
      curr = curr.parentId ? groupMap.get(curr.parentId) : null;
    }
    return parts.length > 0 ? parts.join(' › ') : (groupMap.get(subgroupId)?.name || 'Subfolder');
  }

  _attachEventListeners(groups) {
    // Tree node expand/collapse
    this.container.querySelectorAll('[data-toggle-id]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = btn.dataset.toggleId;
        if (this.expandedGroupIds.has(id)) {
          this.expandedGroupIds.delete(id);
        } else {
          this.expandedGroupIds.add(id);
        }
        this.render();
      });
    });

    // Tree node select
    this.container.querySelectorAll('[data-select-id]').forEach(el => {
      el.addEventListener('click', () => {
        const id = el.dataset.selectId;
        this.selectedGroupId = id;
        this.render();
      });
    });

    // Drag and drop to reorganise folders and decks
    this._attachDragAndDrop(groups);

    // Add root class
    const btnAddRoot = this.container.querySelector('#btn-add-root-group');
    if (btnAddRoot) {
      btnAddRoot.addEventListener('click', () => {
        window.dispatchEvent(new CustomEvent('open-group-modal', { detail: { parentId: null } }));
      });
    }

    // Seed sample button
    const btnSeedSample = this.container.querySelector('#btn-seed-sample');
    if (btnSeedSample) {
      btnSeedSample.addEventListener('click', async () => {
        await storage.seedInitialData();
        this.render();
      });
    }

    // Add card to active group
    const btnAddCard = this.container.querySelector('#btn-add-card-to-group');
    const btnAddCardEmpty = this.container.querySelector('#btn-add-card-empty');
    const handleAddCard = () => {
      window.dispatchEvent(new CustomEvent('open-card-editor', { 
        detail: { defaultGroupId: this.selectedGroupId } 
      }));
    };
    if (btnAddCard) btnAddCard.addEventListener('click', handleAddCard);
    if (btnAddCardEmpty) btnAddCardEmpty.addEventListener('click', handleAddCard);

    // Group study actions
    const btnStudyDaily = this.container.querySelector('#btn-study-group-daily');
    if (btnStudyDaily) {
      btnStudyDaily.addEventListener('click', () => {
        this.navigateTo('study', { mode: 'daily', groupId: this.selectedGroupId, includeSubgroups: true });
      });
    }

    const btnStudyEndless = this.container.querySelector('#btn-study-group-endless');
    if (btnStudyEndless) {
      btnStudyEndless.addEventListener('click', () => {
        this.navigateTo('study', { mode: 'endless', groupId: this.selectedGroupId, includeSubgroups: true });
      });
    }

    // More dropdown toggle
    const btnMore = this.container.querySelector('#btn-group-more');
    const menuMore = this.container.querySelector('#group-more-menu');
    if (btnMore && menuMore) {
      btnMore.addEventListener('click', (e) => {
        e.stopPropagation();
        menuMore.classList.toggle('show');
      });
      document.addEventListener('click', () => menuMore.classList.remove('show'), { once: true });
    }

    // Add subgroup
    const btnAddSubgroup = this.container.querySelector('#btn-add-subgroup');
    if (btnAddSubgroup) {
      btnAddSubgroup.addEventListener('click', () => {
        window.dispatchEvent(new CustomEvent('open-group-modal', { detail: { parentId: this.selectedGroupId } }));
      });
    }

    // Export group
    const btnExportGroup = this.container.querySelector('#btn-export-group');
    if (btnExportGroup) {
      btnExportGroup.addEventListener('click', () => {
        window.dispatchEvent(new CustomEvent('export-group-request', { detail: { groupId: this.selectedGroupId } }));
      });
    }

    // Rename group
    const btnEditGroup = this.container.querySelector('#btn-edit-group');
    if (btnEditGroup) {
      btnEditGroup.addEventListener('click', () => {
        window.dispatchEvent(new CustomEvent('edit-group-modal', { detail: { groupId: this.selectedGroupId } }));
      });
    }

    // Delete group
    const btnDeleteGroup = this.container.querySelector('#btn-delete-group');
    if (btnDeleteGroup) {
      btnDeleteGroup.addEventListener('click', () => {
        window.dispatchEvent(new CustomEvent('delete-group-request', { detail: { groupId: this.selectedGroupId } }));
      });
    }

    // Jump to subgroup from cards list
    this.container.querySelectorAll('.btn-open-subgroup').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = btn.dataset.groupId;
        this.selectedGroupId = id;
        this.expandedGroupIds.add(id);
        this.render();
      });
    });

    // Card item actions
    this.container.querySelectorAll('.btn-edit-card').forEach(btn => {
      btn.addEventListener('click', async () => {
        const card = await storage.getCard(btn.dataset.cardId);
        if (card) {
          window.dispatchEvent(new CustomEvent('open-card-editor', { detail: { card } }));
        }
      });
    });

    this.container.querySelectorAll('.btn-delete-card').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (confirm('Are you sure you want to delete this card?')) {
          await storage.deleteCard(btn.dataset.cardId);
          this.render();
        }
      });
    });
  }

  _attachDragAndDrop(groups) {
    const sidebar = this.container.querySelector('.tree-sidebar');
    const rows = this.container.querySelectorAll('.tree-node-row[draggable="true"]');
    const rootDropzone = this.container.querySelector('.tree-root-dropzone');

    const clearDragIndicators = () => {
      this.container.querySelectorAll('.drag-over-before, .drag-over-after, .drag-over-inside, .drag-over-root').forEach(el => {
        el.classList.remove('drag-over-before', 'drag-over-after', 'drag-over-inside', 'drag-over-root');
      });
    };

    const getDescendantIds = (groupId) => {
      const descendants = new Set([groupId]);
      const findChildren = (pid) => {
        for (const g of groups) {
          if (g.parentId === pid && !descendants.has(g.id)) {
            descendants.add(g.id);
            findChildren(g.id);
          }
        }
      };
      findChildren(groupId);
      return descendants;
    };

    rows.forEach(row => {
      row.addEventListener('dragstart', (e) => {
        const id = row.dataset.dragId;
        this.draggedGroupId = id;
        this.descendantsOfDragged = getDescendantIds(id);
        e.dataTransfer.setData('text/plain', id);
        e.dataTransfer.effectAllowed = 'move';
        row.classList.add('is-dragging');
        if (sidebar) sidebar.classList.add('is-drag-in-progress');
      });

      row.addEventListener('dragend', () => {
        row.classList.remove('is-dragging');
        clearDragIndicators();
        this.draggedGroupId = null;
        this.descendantsOfDragged = null;
        if (this.dragHoverExpandTimer) {
          clearTimeout(this.dragHoverExpandTimer);
          this.dragHoverExpandTimer = null;
        }
        if (sidebar) sidebar.classList.remove('is-drag-in-progress');
      });

      row.addEventListener('dragover', (e) => {
        if (!this.draggedGroupId) return;
        const targetId = row.dataset.dragId;
        // Cannot drop into itself or any descendant
        if (!targetId || this.descendantsOfDragged?.has(targetId)) {
          e.dataTransfer.dropEffect = 'none';
          return;
        }

        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'move';

        const rect = row.getBoundingClientRect();
        const relY = (e.clientY - rect.top) / rect.height;

        let pos = 'inside';
        if (relY < 0.28) {
          pos = 'before';
        } else if (relY > 0.72) {
          pos = 'after';
        } else {
          pos = 'inside';
        }

        const currentPosClass = `drag-over-${pos}`;
        if (!row.classList.contains(currentPosClass)) {
          clearDragIndicators();
          row.classList.add(currentPosClass);

          if (this.dragHoverExpandTimer) {
            clearTimeout(this.dragHoverExpandTimer);
            this.dragHoverExpandTimer = null;
          }
          if (pos === 'inside' && !this.expandedGroupIds.has(targetId)) {
            this.dragHoverExpandTimer = setTimeout(() => {
              this.expandedGroupIds.add(targetId);
              this.render();
            }, 550);
          }
        }
      });

      row.addEventListener('dragleave', (e) => {
        if (!row.contains(e.relatedTarget)) {
          row.classList.remove('drag-over-before', 'drag-over-after', 'drag-over-inside');
          if (this.dragHoverExpandTimer) {
            clearTimeout(this.dragHoverExpandTimer);
            this.dragHoverExpandTimer = null;
          }
        }
      });

      row.addEventListener('drop', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const draggedId = this.draggedGroupId || e.dataTransfer.getData('text/plain');
        const targetId = row.dataset.dragId;
        if (!draggedId || !targetId || this.descendantsOfDragged?.has(targetId)) {
          clearDragIndicators();
          return;
        }

        const rect = row.getBoundingClientRect();
        const relY = (e.clientY - rect.top) / rect.height;

        let pos = 'inside';
        if (relY < 0.28) {
          pos = 'before';
        } else if (relY > 0.72) {
          pos = 'after';
        } else {
          pos = 'inside';
        }

        clearDragIndicators();
        await this._handleGroupDrop(draggedId, targetId, pos);
      });
    });

    if (rootDropzone) {
      rootDropzone.addEventListener('dragover', (e) => {
        if (!this.draggedGroupId) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        clearDragIndicators();
        rootDropzone.classList.add('drag-over-root');
      });

      rootDropzone.addEventListener('dragleave', (e) => {
        if (!rootDropzone.contains(e.relatedTarget)) {
          rootDropzone.classList.remove('drag-over-root');
        }
      });

      rootDropzone.addEventListener('drop', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        clearDragIndicators();
        const draggedId = this.draggedGroupId || e.dataTransfer.getData('text/plain');
        if (!draggedId) return;
        await this._handleGroupDrop(draggedId, null, 'root');
      });
    }
  }

  async _handleGroupDrop(draggedId, targetId, position) {
    if (!draggedId) return;
    const allGroups = await storage.getGroups();
    const draggedGroup = allGroups.find(g => g.id === draggedId);
    if (!draggedGroup) return;

    const targetGroup = targetId ? allGroups.find(g => g.id === targetId) : null;

    // Group buckets by parentId
    const groupsByParent = new Map();
    for (const g of allGroups) {
      const pid = g.parentId || '__root__';
      if (!groupsByParent.has(pid)) groupsByParent.set(pid, []);
      groupsByParent.get(pid).push(g);
    }

    // Ensure initial deterministic order on every bucket
    for (const list of groupsByParent.values()) {
      list.sort((a, b) => {
        const oa = typeof a.order === 'number' ? a.order : 0;
        const ob = typeof b.order === 'number' ? b.order : 0;
        if (oa !== ob) return oa - ob;
        return (a.createdAt || '').localeCompare(b.createdAt || '');
      });
      list.forEach((item, idx) => {
        item.order = idx;
      });
    }

    const modified = new Set();

    if (position === 'root' || (!targetGroup && position === 'root')) {
      // Re-parent to top-level
      const oldParentKey = draggedGroup.parentId || '__root__';
      const oldSiblings = (groupsByParent.get(oldParentKey) || []).filter(g => g.id !== draggedGroup.id);
      oldSiblings.forEach((g, idx) => {
        g.order = idx;
        modified.add(g);
      });

      draggedGroup.parentId = null;
      if (draggedGroup.type !== 'class') draggedGroup.type = 'class';

      const rootSiblings = (groupsByParent.get('__root__') || []).filter(g => g.id !== draggedGroup.id);
      draggedGroup.order = rootSiblings.length;
      rootSiblings.push(draggedGroup);
      rootSiblings.forEach((g, idx) => {
        g.order = idx;
        modified.add(g);
      });
    } else if (position === 'inside') {
      // Move inside targetGroup as a child
      const oldParentKey = draggedGroup.parentId || '__root__';
      const oldSiblings = (groupsByParent.get(oldParentKey) || []).filter(g => g.id !== draggedGroup.id);
      oldSiblings.forEach((g, idx) => {
        g.order = idx;
        modified.add(g);
      });

      draggedGroup.parentId = targetGroup.id;
      if (targetGroup.type === 'class' && draggedGroup.type === 'class') {
        draggedGroup.type = 'unit';
      } else if (targetGroup.type === 'unit') {
        draggedGroup.type = 'lesson';
      } else if (targetGroup.type === 'lesson') {
        draggedGroup.type = 'concept';
      }

      this.expandedGroupIds.add(targetGroup.id);

      const targetChildren = (groupsByParent.get(targetGroup.id) || []).filter(g => g.id !== draggedGroup.id);
      draggedGroup.order = targetChildren.length;
      targetChildren.push(draggedGroup);
      targetChildren.forEach((g, idx) => {
        g.order = idx;
        modified.add(g);
      });
    } else if (position === 'before' || position === 'after') {
      const oldParentKey = draggedGroup.parentId || '__root__';
      const newParentKey = targetGroup.parentId || '__root__';

      if (oldParentKey !== newParentKey) {
        const oldSiblings = (groupsByParent.get(oldParentKey) || []).filter(g => g.id !== draggedGroup.id);
        oldSiblings.forEach((g, idx) => {
          g.order = idx;
          modified.add(g);
        });
      }

      draggedGroup.parentId = targetGroup.parentId;
      if (targetGroup.parentId === null) {
        if (draggedGroup.type !== 'class') draggedGroup.type = 'class';
      } else {
        draggedGroup.type = targetGroup.type;
      }

      const siblings = (groupsByParent.get(newParentKey) || []).filter(g => g.id !== draggedGroup.id);
      const targetIdx = siblings.findIndex(g => g.id === targetGroup.id);

      const insertIdx = position === 'before' ? Math.max(0, targetIdx) : targetIdx + 1;
      siblings.splice(insertIdx, 0, draggedGroup);

      siblings.forEach((g, idx) => {
        g.order = idx;
        modified.add(g);
      });
    }

    // Save all modified groups to storage
    for (const g of modified) {
      await storage.saveGroup(g);
    }

    this.selectedGroupId = draggedGroup.id;
    this.expandedGroupIds.add(draggedGroup.id);
    await this.render();
  }
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
