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

  // 3. Other cards (Basic, Reversible, Image, etc.)
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

// Built-in sample SVG image for the animal cell diagram (self-contained, high quality SVG data URI)
const CELL_DIAGRAM_SVG = `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600" width="800" height="600">
  <defs>
    <radialGradient id="cellBg" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="%23f0fdf4"/>
      <stop offset="90%" stop-color="%23dcfce7"/>
      <stop offset="100%" stop-color="%2386efac"/>
    </radialGradient>
    <radialGradient id="nucBg" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="%2393c5fd"/>
      <stop offset="80%" stop-color="%233b82f6"/>
      <stop offset="100%" stop-color="%231d4ed8"/>
    </radialGradient>
    <radialGradient id="mitoBg" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="%23fca5a5"/>
      <stop offset="90%" stop-color="%23ef4444"/>
    </radialGradient>
  </defs>

  <rect width="800" height="600" fill="%23fdfbf7"/>
  
  <!-- Outer Cell Membrane -->
  <path d="M 120 280 C 120 120, 300 80, 500 100 C 700 120, 740 300, 680 460 C 620 560, 380 570, 200 520 C 130 470, 120 380, 120 280 Z" fill="url(%23cellBg)" stroke="%2316a34a" stroke-width="8"/>
  
  <!-- Cytoplasm text in background -->
  <text x="350" y="520" font-family="sans-serif" font-size="22" font-weight="bold" fill="%2315803d">Cytoplasm</text>

  <!-- Nucleus -->
  <ellipse cx="380" cy="270" rx="110" ry="95" fill="url(%23nucBg)" stroke="%231e40af" stroke-width="6"/>
  <!-- Nucleolus -->
  <circle cx="380" cy="270" r="40" fill="%231e3a8a"/>
  <!-- Nucleus label -->
  <rect x="305" y="255" width="150" height="32" rx="6" fill="%23ffffff" opacity="0.95"/>
  <text x="380" y="277" font-family="sans-serif" font-size="18" font-weight="bold" fill="%231e3a8a" text-anchor="middle">Nucleus</text>

  <!-- Mitochondria 1 (Top Right) -->
  <ellipse cx="580" cy="200" rx="65" ry="38" fill="url(%23mitoBg)" stroke="%23b91c1c" stroke-width="4" transform="rotate(-20 580 200)"/>
  <path d="M 540 195 Q 555 185, 570 205 T 605 195 T 620 205" stroke="%23fef2f2" stroke-width="3" fill="none" transform="rotate(-20 580 200)"/>
  <rect x="520" y="185" width="125" height="28" rx="5" fill="%23ffffff" opacity="0.95"/>
  <text x="582" y="205" font-family="sans-serif" font-size="15" font-weight="bold" fill="%23991b1b" text-anchor="middle">Mitochondria</text>

  <!-- Mitochondria 2 (Bottom Left) -->
  <ellipse cx="230" cy="400" rx="60" ry="35" fill="url(%23mitoBg)" stroke="%23b91c1c" stroke-width="4" transform="rotate(35 230 400)"/>
  
  <!-- Golgi Apparatus (Right) -->
  <path d="M 570 340 C 600 330, 630 360, 610 390 C 640 395, 620 430, 580 430" stroke="%23eab308" stroke-width="12" stroke-linecap="round" fill="none"/>
  <rect x="540" y="440" width="145" height="28" rx="5" fill="%23ffffff" opacity="0.95"/>
  <text x="612" y="460" font-family="sans-serif" font-size="15" font-weight="bold" fill="%23854d0e" text-anchor="middle">Golgi Body</text>

  <!-- Ribosomes -->
  <circle cx="270" cy="200" r="7" fill="%236b21a8"/>
  <circle cx="285" cy="220" r="7" fill="%236b21a8"/>
  <circle cx="260" cy="235" r="7" fill="%236b21a8"/>
  <rect x="210" y="150" width="115" height="28" rx="5" fill="%23ffffff" opacity="0.95"/>
  <text x="267" y="170" font-family="sans-serif" font-size="15" font-weight="bold" fill="%236b21a8" text-anchor="middle">Ribosomes</text>
  <line x1="267" y1="178" x2="270" y2="195" stroke="%236b21a8" stroke-width="2"/>

  <!-- Endoplasmic Reticulum (Surrounding Nucleus) -->
  <path d="M 270 280 C 240 260, 240 320, 260 350 C 240 370, 270 410, 300 390" stroke="%2306b6d4" stroke-width="10" stroke-linecap="round" fill="none"/>
  
  <text x="400" y="45" font-family="sans-serif" font-size="26" font-weight="bold" fill="%230f172a" text-anchor="middle">Animal Cell Structure</text>
</svg>`;

export function getSampleData() {
  const { gkGroups, gkCards } = getGeneralKnowledgeData();
  const today = getDateString();

  // Hierarchical groups:
  // Class: Biology
  //   Unit 1: Cell Biology
  //     Lesson 1: Organelles & Functions
  //   Unit 2: Genetics & Inheritance
  // Class: Spanish (Year 9)
  //   Unit 1: Essential Vocabulary
  const groups = [
    {
      id: 'grp_bio',
      parentId: null,
      name: 'Biology',
      type: GROUP_TYPES.CLASS,
      color: '#2d6a4f',
      icon: 'dna',
      createdAt: new Date().toISOString()
    },
    {
      id: 'grp_bio_u1',
      parentId: 'grp_bio',
      name: 'Unit 1: Cell Biology',
      type: GROUP_TYPES.UNIT,
      color: '#38734e',
      icon: 'microscope',
      createdAt: new Date().toISOString()
    },
    {
      id: 'grp_bio_u1_l1',
      parentId: 'grp_bio_u1',
      name: 'Lesson 1: Organelles',
      type: GROUP_TYPES.LESSON,
      color: '#408058',
      icon: 'cell',
      createdAt: new Date().toISOString()
    },
    {
      id: 'grp_bio_u2',
      parentId: 'grp_bio',
      name: 'Unit 2: Genetics',
      type: GROUP_TYPES.UNIT,
      color: '#3d6884',
      icon: 'dna',
      createdAt: new Date().toISOString()
    },
    {
      id: 'grp_spanish',
      parentId: null,
      name: 'Spanish',
      type: GROUP_TYPES.CLASS,
      color: '#b87320',
      icon: 'globe',
      createdAt: new Date().toISOString()
    },
    {
      id: 'grp_spanish_u1',
      parentId: 'grp_spanish',
      name: 'Unit 1: Essential Vocab',
      type: GROUP_TYPES.UNIT,
      color: '#a65d14',
      icon: 'book',
      createdAt: new Date().toISOString()
    }
  ];

  const cards = [
    // 1. Basic Flashcard
    createCard({
      id: 'card_demo_1',
      groupId: 'grp_bio_u1_l1',
      type: CARD_TYPES.BASIC,
      front: 'What is the primary function of the Ribosomes in a cell?',
      back: 'Ribosomes are the cellular machines responsible for protein synthesis (translating messenger RNA into polypeptide chains).',
      hint: 'Think about protein synthesis!',
      tags: ['biology', 'organelles'],
      srs: {
        state: 'new',
        interval: 0,
        easeFactor: 2.5,
        reps: 0,
        lapses: 0,
        dueDate: today
      }
    }),

    // 2. Cloze Deletion Card
    createCard({
      id: 'card_demo_2',
      groupId: 'grp_bio_u1_l1',
      type: CARD_TYPES.CLOZE,
      front: 'Cloze Deletion: Cell Respiration',
      clozeText: 'The powerhouse of the cell is the {{c1::mitochondria}}, which produces cellular energy in the form of {{c2::ATP}} through cellular respiration.',
      back: 'Mitochondria convert glucose and oxygen into ATP, the cell\'s primary energy currency.',
      tags: ['biology', 'energy'],
      srs: {
        state: 'new',
        interval: 0,
        easeFactor: 2.5,
        reps: 0,
        lapses: 0,
        dueDate: today
      }
    }),

    // 3. Image Occlusion Card (Animal Cell Diagram)
    createCard({
      id: 'card_demo_3',
      groupId: 'grp_bio_u1_l1',
      type: CARD_TYPES.IMAGE_OCCLUSION,
      front: 'Animal Cell: Identify the key organelles',
      back: 'Animal cell diagram with labeled Nucleus, Mitochondria, Golgi Body, and Ribosomes.',
      imageUrl: CELL_DIAGRAM_SVG,
      imageOcclusions: [
        {
          id: 'occ_1',
          x: 37.5, // 300 / 800 * 100
          y: 41.5, // 250 / 600 * 100
          width: 20, // 160 / 800 * 100
          height: 7, // 42 / 600 * 100
          label: 'Nucleus'
        },
        {
          id: 'occ_2',
          x: 64, // 515 / 800 * 100
          y: 29.5, // 178 / 600 * 100
          width: 17.5,
          height: 6.5,
          label: 'Mitochondria'
        },
        {
          id: 'occ_3',
          x: 66.5,
          y: 72,
          width: 19.5,
          height: 6.5,
          label: 'Golgi Body'
        },
        {
          id: 'occ_4',
          x: 25.5,
          y: 24,
          width: 16,
          height: 6.5,
          label: 'Ribosomes'
        }
      ],
      tags: ['biology', 'diagram', 'occlusion'],
      srs: {
        state: 'new',
        interval: 0,
        easeFactor: 2.5,
        reps: 0,
        lapses: 0,
        dueDate: today
      }
    }),

    // 4. Reversible Card (Spanish)
    createCard({
      id: 'card_demo_4',
      groupId: 'grp_spanish_u1',
      type: CARD_TYPES.REVERSIBLE,
      front: '¿Cómo estás?',
      back: 'How are you? (Informal)',
      hint: 'A casual greeting in Spanish',
      tags: ['spanish', 'greetings'],
      srs: {
        state: 'new',
        interval: 0,
        easeFactor: 2.5,
        reps: 0,
        lapses: 0,
        dueDate: today
      }
    }),

    // 5. Another Reversible Card (Spanish)
    createCard({
      id: 'card_demo_5',
      groupId: 'grp_spanish_u1',
      type: CARD_TYPES.REVERSIBLE,
      front: 'Buenos días',
      back: 'Good morning',
      tags: ['spanish'],
      srs: {
        state: 'new',
        interval: 0,
        easeFactor: 2.5,
        reps: 0,
        lapses: 0,
        dueDate: today
      }
    }),

    // 6. Cloze Card (Genetics)
    createCard({
      id: 'card_demo_6',
      groupId: 'grp_bio_u2',
      type: CARD_TYPES.CLOZE,
      front: 'DNA Molecular Structure',
      clozeText: 'DNA stands for {{c1::Deoxyribonucleic Acid}} and has a shape known as a {{c2::double helix}}.',
      back: 'The double helix was described by Watson, Crick, and Rosalind Franklin.',
      tags: ['genetics'],
      srs: {
        state: 'new',
        interval: 0,
        easeFactor: 2.5,
        reps: 0,
        lapses: 0,
        dueDate: today
      }
    })
  ];

  return {
    groups: [...gkGroups, ...groups],
    cards: [...gkCards, ...cards]
  };
}
