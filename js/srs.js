/**
 * Spaced Repetition System (SRS) Engine
 * Anki-adapted SuperMemo-2 (SM-2) algorithm with back-off mechanism.
 */

export const CARD_STATES = {
  NEW: 'new',
  LEARNING: 'learning',
  REVIEW: 'review',
  RELEARNING: 'relearning'
};

export const RATINGS = {
  AGAIN: 1, // Complete blackout, lapse
  HARD: 2,  // Hesitant, difficult recall
  GOOD: 3,  // Normal, correct recall
  EASY: 4   // Instant, effortless recall
};

export const DEFAULT_SRS_DATA = {
  state: CARD_STATES.NEW,
  interval: 0,       // In days
  easeFactor: 2.5,   // Standard starting ease factor (250%)
  reps: 0,           // Successful consecutive repetitions
  lapses: 0,         // Number of times card was forgotten
  dueDate: new Date().toISOString().split('T')[0], // YYYY-MM-DD
  lastReviewed: null
};

/**
 * Format interval in days into human readable text for Anki-style buttons
 * @param {number} days 
 * @param {string} state 
 * @returns {string} e.g. "<10m", "1d", "3d", "2mo"
 */
export function formatInterval(days, state) {
  if (days <= 0 || state === CARD_STATES.LEARNING || state === CARD_STATES.RELEARNING) {
    return '< 10m';
  }
  if (days === 1) return '1 day';
  if (days < 30) return `${days} days`;
  if (days < 365) {
    const months = Math.round(days / 30);
    return `${months} mo`;
  }
  const years = (days / 365).toFixed(1);
  return `${years} yr`;
}

/**
 * Get date string formatted as YYYY-MM-DD
 * @param {Date} [date] 
 * @returns {string}
 */
export function getDateString(date = new Date()) {
  return date.toISOString().split('T')[0];
}

/**
 * Add days to a given date string or current date
 * @param {number} days 
 * @param {string|Date} [baseDate] 
 * @returns {string} YYYY-MM-DD
 */
export function addDays(days, baseDate = new Date()) {
  const d = new Date(baseDate);
  d.setDate(d.getDate() + days);
  return getDateString(d);
}

/**
 * Compute the next SRS state and scheduling given a rating (1: Again, 2: Hard, 3: Good, 4: Easy)
 * @param {Object} currentSrs 
 * @param {number} rating 
 * @returns {Object} Updated SRS data
 */
export function processReview(currentSrs = DEFAULT_SRS_DATA, rating) {
  const now = new Date();
  const todayStr = getDateString(now);

  const prev = {
    state: currentSrs.state || CARD_STATES.NEW,
    interval: currentSrs.interval || 0,
    easeFactor: Math.max(1.3, currentSrs.easeFactor || 2.5),
    reps: currentSrs.reps || 0,
    lapses: currentSrs.lapses || 0
  };

  let nextState = prev.state;
  let nextInterval = prev.interval;
  let nextEase = prev.easeFactor;
  let nextReps = prev.reps;
  let nextLapses = prev.lapses;

  if (rating === RATINGS.AGAIN) {
    // LAPSE: Back-off interval, increase lapse count, drop ease factor
    nextLapses += 1;
    nextReps = 0;
    nextInterval = 1; // Back off to 1 day (or review again today)
    nextEase = Math.max(1.3, prev.easeFactor - 0.20);
    nextState = CARD_STATES.RELEARNING;
  } else if (rating === RATINGS.HARD) {
    // HARD: Slower interval increase, slight ease penalty
    nextEase = Math.max(1.3, prev.easeFactor - 0.15);
    if (prev.state === CARD_STATES.NEW || prev.interval <= 1) {
      nextInterval = 1;
      nextReps = 1;
    } else {
      nextInterval = Math.max(prev.interval + 1, Math.round(prev.interval * 1.2));
      nextReps += 1;
    }
    nextState = CARD_STATES.REVIEW;
  } else if (rating === RATINGS.GOOD) {
    // GOOD: Standard SM-2 interval progression
    if (prev.state === CARD_STATES.NEW || prev.interval === 0) {
      nextInterval = 1;
      nextReps = 1;
    } else if (prev.interval === 1) {
      nextInterval = 3; // Second step
      nextReps = 2;
    } else {
      nextInterval = Math.max(prev.interval + 1, Math.round(prev.interval * prev.easeFactor));
      nextReps += 1;
    }
    nextState = CARD_STATES.REVIEW;
  } else if (rating === RATINGS.EASY) {
    // EASY: High interval bonus, boost ease factor
    nextEase = Math.min(3.5, prev.easeFactor + 0.15);
    if (prev.state === CARD_STATES.NEW || prev.interval === 0) {
      nextInterval = 4;
      nextReps = 1;
    } else if (prev.interval <= 1) {
      nextInterval = 5;
      nextReps = 2;
    } else {
      nextInterval = Math.max(prev.interval + 2, Math.round(prev.interval * prev.easeFactor * 1.3));
      nextReps += 1;
    }
    nextState = CARD_STATES.REVIEW;
  }

  const nextDueDate = addDays(nextInterval, now);

  return {
    state: nextState,
    interval: nextInterval,
    easeFactor: Number(nextEase.toFixed(2)),
    reps: nextReps,
    lapses: nextLapses,
    dueDate: nextDueDate,
    lastReviewed: now.toISOString()
  };
}

/**
 * Calculate predicted next intervals for all 4 ratings to display on buttons
 * @param {Object} currentSrs 
 * @returns {Object} { 1: { intervalText, nextInterval }, 2: ..., 3: ..., 4: ... }
 */
export function getRatingPredictions(currentSrs = DEFAULT_SRS_DATA) {
  const result = {};
  for (const rating of [RATINGS.AGAIN, RATINGS.HARD, RATINGS.GOOD, RATINGS.EASY]) {
    const outcome = processReview(currentSrs, rating);
    result[rating] = {
      interval: outcome.interval,
      intervalText: formatInterval(outcome.interval, outcome.state),
      state: outcome.state
    };
  }
  return result;
}

/**
 * Checks whether a card is due for daily review on or before targetDate
 * @param {Object} card 
 * @param {string} [targetDate] YYYY-MM-DD
 * @returns {boolean}
 */
export function isCardDue(card, targetDate = getDateString()) {
  if (!card) return false;

  // If this is a parent image occlusion card with multiple boxes in guess-one mode
  if (
    card.type === 'image_occlusion' &&
    card.targetBoxId === undefined &&
    card.occlusionMode !== 'hide_all_guess_all' &&
    Array.isArray(card.imageOcclusions) &&
    card.imageOcclusions.length > 0
  ) {
    return card.imageOcclusions.some((box, index) => {
      const boxId = box.id || `box_${index}`;
      const boxSrs = (card.boxSrs && card.boxSrs[boxId]) || card.srs;
      if (!boxSrs || !boxSrs.dueDate) return true;
      return boxSrs.dueDate <= targetDate;
    });
  }

  // If this is a parent cloze card with multiple deletions in guess-one mode
  if (
    card.type === 'cloze' &&
    card.targetClozeNum === undefined &&
    card.clozeMode !== 'hide_all_guess_all'
  ) {
    const clozeText = card.clozeText || card.front || '';
    const matches = [...clozeText.matchAll(/\{\{c(\d+)::/g)].map(m => parseInt(m[1], 10));
    const uniqueNums = [...new Set(matches)];
    if (uniqueNums.length > 1) {
      return uniqueNums.some(num => {
        const clozeSrs = (card.clozeSrs && card.clozeSrs[`c${num}`]) || card.srs;
        if (!clozeSrs || !clozeSrs.dueDate) return true;
        return clozeSrs.dueDate <= targetDate;
      });
    }
  }

  if (!card.srs || !card.srs.dueDate) return true;
  return card.srs.dueDate <= targetDate;
}
