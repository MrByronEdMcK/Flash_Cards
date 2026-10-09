/**
 * Data models and pre-loaded sample decks
 */

import { DEFAULT_SRS_DATA, getDateString, isCardDue } from './srs.js';
import { getGeneralKnowledgeData } from './generalKnowledgeData.js';

export { getGeneralKnowledgeData };

export const CARD_TYPES = {
  BASIC: 'basic',
  REVERSIBLE: 'reversible',
  CLOZE: 'cloze',
  IMAGE: 'image',
  IMAGE_OCCLUSION: 'image_occlusion'
};

export const OCCLUSION_MODES = {
  HIDE_ALL_GUESS_ONE: 'hide_all_guess_one',
  HIDE_ALL_GUESS_ALL: 'hide_all_guess_all',
  HIDE_ONE_GUESS_ONE: 'hide_one_guess_one'
};

export const GROUP_TYPES = {
  CLASS: 'class',
  UNIT: 'unit',
  LESSON: 'lesson',
  CONCEPT: 'concept',
  CUSTOM: 'custom'
};

export function generateId(prefix = 'id') {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

export function createCard(data = {}) {
  const now = new Date().toISOString();
  return {
    id: data.id || generateId('card'),
    groupId: data.groupId || null,
    type: data.type || CARD_TYPES.BASIC,
    front: data.front || '',
    back: data.back || '',
    hint: data.hint || '',
    clozeText: data.clozeText || '',
    clozeMode: data.clozeMode || OCCLUSION_MODES.HIDE_ALL_GUESS_ONE,
    clozeSrs: data.clozeSrs ? { ...data.clozeSrs } : {},
    imageUrl: data.imageUrl || '',
    imageOcclusions: Array.isArray(data.imageOcclusions) ? data.imageOcclusions : [],
    occlusionMode: data.occlusionMode || OCCLUSION_MODES.HIDE_ALL_GUESS_ONE,
    boxSrs: data.boxSrs ? { ...data.boxSrs } : {},
    srs: {
      ...DEFAULT_SRS_DATA,
      ...(data.srs || {})
    },
    tags: Array.isArray(data.tags) ? data.tags : [],
    createdAt: data.createdAt || now,
    updatedAt: now
  };
}

/**
 * Extract unique sorted cloze deletion numbers from text.
 * e.g. "The {{c1::ATP}} and {{c1::glucose}} with {{c2::oxygen}}" -> [1, 2]
 * @param {string} clozeText 
 * @returns {Array<number>}
 */
export function getClozeNumbers(clozeText) {
  if (!clozeText) return [];
  const matches = [...clozeText.matchAll(/\{\{c(\d+)::/g)];
  const nums = matches.map(m => parseInt(m[1], 10));
  return [...new Set(nums)].sort((a, b) => a - b);
}

/**
 * Render cloze text with masking or reveal depending on mode and target cloze number.
 * Supports hints: {{c1::answer::hint}}
 * Supports modes: 'hide_all_guess_one', 'hide_all_guess_all', 'hide_one_guess_one'
 * @param {string} rawText 
 * @param {boolean} isRevealed 
 * @param {number} targetNum 
 * @param {string} mode 
 * @returns {string} HTML string
 */
export function renderClozeText(rawText, isRevealed = false, targetNum = 1, mode = 'hide_all_guess_one') {
  if (!rawText) return '';

  return rawText.replace(/\{\{c(\d+)::([^}]+?)\}\}/g, (match, numStr, inner) => {
    const num = parseInt(numStr, 10);
    const isTarget = num === targetNum;

    const parts = inner.split('::');
    const answer = parts[0];
    const hint = parts[1] || '';

    if (mode === OCCLUSION_MODES.HIDE_ALL_GUESS_ALL) {
      if (isRevealed) {
        return `<mark class="cloze-revealed">${escapeHtml(answer)}</mark>`;
      }
      return `<span class="cloze-masked">[ ${hint ? escapeHtml(hint) : '...'} ]</span>`;
    }

    if (mode === OCCLUSION_MODES.HIDE_ONE_GUESS_ONE) {
      if (isTarget) {
        if (isRevealed) {
          return `<mark class="cloze-revealed">${escapeHtml(answer)}</mark>`;
        }
        return `<span class="cloze-masked target-cloze">[ ${hint ? escapeHtml(hint) : '...'} ]</span>`;
      }
      // Non-target: plain text for surrounding context
      return escapeHtml(answer);
    }

    // Default: 'hide_all_guess_one'
    if (isTarget) {
      if (isRevealed) {
        return `<mark class="cloze-revealed target-cloze">${escapeHtml(answer)}</mark>`;
      }
      return `<span class="cloze-masked target-cloze">[ ${hint ? escapeHtml(hint) : '? ...'} ]</span>`;
    } else {
      // Non-target stays masked
      return `<span class="cloze-masked other-cloze">[ ... ]</span>`;
    }
  });
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Returns reviewable card items for a given card.
 * In Anki fashion:
 * 1. An Image Occlusion card generates 1 review card per occlusion box in guess-one modes.
 * 2. A Cloze card generates 1 review card per unique cloze number (c1, c2, ...) in guess-one modes.
 * @param {Object} card 
 * @returns {Array<Object>}
 */
export function getReviewItemsForCard(card) {
  if (!card) return [];

  // 1. Image Occlusion cards (multi-box)
  const isMultiBoxOcclusion =
    card.type === CARD_TYPES.IMAGE_OCCLUSION &&
    (card.occlusionMode === OCCLUSION_MODES.HIDE_ALL_GUESS_ONE ||
     card.occlusionMode === OCCLUSION_MODES.HIDE_ONE_GUESS_ONE ||
     !card.occlusionMode) &&
    Array.isArray(card.imageOcclusions) &&
    card.imageOcclusions.length > 0;

  if (isMultiBoxOcclusion) {
    return card.imageOcclusions.map((box, index) => {
      const boxId = box.id || `box_${index}`;
      const boxSrs = (card.boxSrs && card.boxSrs[boxId]) || card.srs || DEFAULT_SRS_DATA;
      return {
        ...card,
        reviewItemId: `${card.id}_box_${boxId}`,
        targetOcclusionIndex: index,
        targetBoxId: boxId,
        parentCard: card,
        srs: { ...DEFAULT_SRS_DATA, ...boxSrs }
      };
    });
  }

  // 2. Cloze cards (multi-deletion)
  if (card.type === CARD_TYPES.CLOZE) {
    const clozeText = card.clozeText || card.front || '';
    const uniqueNums = getClozeNumbers(clozeText);
    const mode = card.clozeMode || OCCLUSION_MODES.HIDE_ALL_GUESS_ONE;

    if (mode !== OCCLUSION_MODES.HIDE_ALL_GUESS_ALL && uniqueNums.length > 1) {
      return uniqueNums.map(num => {
        const clozeSrs = (card.clozeSrs && card.clozeSrs[`c${num}`]) || card.srs || DEFAULT_SRS_DATA;
        return {
          ...card,
          reviewItemId: `${card.id}_cloze_c${num}`,
          targetClozeNum: num,
          parentCard: card,
          srs: { ...DEFAULT_SRS_DATA, ...clozeSrs }
        };
      });
    } else {
      const targetNum = uniqueNums[0] || 1;
      const clozeSrs = (card.clozeSrs && card.clozeSrs[`c${targetNum}`]) || card.srs || DEFAULT_SRS_DATA;
      return [{
        ...card,
        reviewItemId: card.id,
        targetClozeNum: targetNum,
        parentCard: card,
        srs: { ...DEFAULT_SRS_DATA, ...clozeSrs }
      }];
    }
  }

  // 3. Reversible cards (Forward & Reverse review items)
  if (card.type === CARD_TYPES.REVERSIBLE) {
    const fwdSrs = (card.reversibleSrs && card.reversibleSrs.fwd) || card.srs || DEFAULT_SRS_DATA;
    const revSrs = (card.reversibleSrs && card.reversibleSrs.rev) || DEFAULT_SRS_DATA;
    return [
      {
        ...card,
        reviewItemId: `${card.id}_fwd`,
        isReverse: false,
        parentCard: card,
        srs: { ...DEFAULT_SRS_DATA, ...fwdSrs }
      },
      {
        ...card,
        reviewItemId: `${card.id}_rev`,
        isReverse: true,
        parentCard: card,
        srs: { ...DEFAULT_SRS_DATA, ...revSrs }
      }
    ];
  }

  // 4. Other cards (Basic, Single Cloze, Single Image, etc.)
  return [{
    ...card,
    reviewItemId: card.id,
    targetOcclusionIndex: 0,
    parentCard: card,
    srs: { ...DEFAULT_SRS_DATA, ...(card.srs || {}) }
  }];
}

/**
 * Get total number of reviewable cards represented by a card record.
 * @param {Object} card 
 * @returns {number}
 */
export function getCardCount(card) {
  if (!card) return 0;
  if (
    card.type === CARD_TYPES.IMAGE_OCCLUSION &&
    (card.occlusionMode === OCCLUSION_MODES.HIDE_ALL_GUESS_ONE ||
     card.occlusionMode === OCCLUSION_MODES.HIDE_ONE_GUESS_ONE ||
     !card.occlusionMode) &&
    Array.isArray(card.imageOcclusions) &&
    card.imageOcclusions.length > 0
  ) {
    return card.imageOcclusions.length;
  }

  if (card.type === CARD_TYPES.CLOZE) {
    const uniqueNums = getClozeNumbers(card.clozeText || card.front);
    const mode = card.clozeMode || OCCLUSION_MODES.HIDE_ALL_GUESS_ONE;
    if (mode !== OCCLUSION_MODES.HIDE_ALL_GUESS_ALL && uniqueNums.length > 1) {
      return uniqueNums.length;
    }
    return 1;
  }

  if (card.type === CARD_TYPES.REVERSIBLE) {
    return 2;
  }

  return 1;
}

/**
 * Get total number of due cards represented by a card record.
 * @param {Object} card 
 * @param {string} [targetDate]
 * @returns {number}
 */
export function getDueCountForCard(card, targetDate = getDateString()) {
  if (!card) return 0;
  if (
    card.type === CARD_TYPES.IMAGE_OCCLUSION &&
    (card.occlusionMode === OCCLUSION_MODES.HIDE_ALL_GUESS_ONE ||
     card.occlusionMode === OCCLUSION_MODES.HIDE_ONE_GUESS_ONE ||
     !card.occlusionMode) &&
    Array.isArray(card.imageOcclusions) &&
    card.imageOcclusions.length > 0
  ) {
    return card.imageOcclusions.filter((box, index) => {
      const boxId = box.id || `box_${index}`;
      const boxSrs = (card.boxSrs && card.boxSrs[boxId]) || card.srs || DEFAULT_SRS_DATA;
      return isCardDue({ srs: boxSrs }, targetDate);
    }).length;
  }

  if (card.type === CARD_TYPES.CLOZE) {
    const uniqueNums = getClozeNumbers(card.clozeText || card.front);
    const mode = card.clozeMode || OCCLUSION_MODES.HIDE_ALL_GUESS_ONE;
    if (mode !== OCCLUSION_MODES.HIDE_ALL_GUESS_ALL && uniqueNums.length > 1) {
      return uniqueNums.filter(num => {
        const clozeSrs = (card.clozeSrs && card.clozeSrs[`c${num}`]) || card.srs || DEFAULT_SRS_DATA;
        return isCardDue({ srs: clozeSrs }, targetDate);
      }).length;
    }
  }

  if (card.type === CARD_TYPES.REVERSIBLE) {
    const fwdSrs = (card.reversibleSrs && card.reversibleSrs.fwd) || card.srs || DEFAULT_SRS_DATA;
    const revSrs = (card.reversibleSrs && card.reversibleSrs.rev) || DEFAULT_SRS_DATA;
    let due = 0;
    if (isCardDue({ srs: fwdSrs }, targetDate)) due++;
    if (isCardDue({ srs: revSrs }, targetDate)) due++;
    return due;
  }

  return isCardDue(card, targetDate) ? 1 : 0;
}

export function createGroup(data = {}) {
  return {
    id: data.id || generateId('group'),
    parentId: data.parentId || null, // null = root level
    name: data.name || 'New Group',
    type: data.type || GROUP_TYPES.CUSTOM,
    color: data.color || '#c05638',
    icon: data.icon || 'folder',
    order: typeof data.order === 'number' ? data.order : 0,
    createdAt: data.createdAt || new Date().toISOString()
  };
}

export function createDefaultSettings() {
  return {
    dailyNewLimit: 20,
    dailyReviewLimit: 100,
    streak: 1,
    lastActiveDate: getDateString(),
    cardsReviewedToday: 0,
    theme: 'light',
    accent: 'orange',
    focusedGroupIds: ['grp_gk']
  };
}

export function getSampleData() {
  const { gkGroups, gkCards } = getGeneralKnowledgeData();
  return {
    groups: gkGroups,
    cards: gkCards
  };
}
