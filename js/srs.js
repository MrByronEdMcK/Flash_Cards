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

/**
 * Safely parse a date or date string (YYYY-MM-DD) into a local Date object.
 * Avoids UTC shifting that occurs with new Date('YYYY-MM-DD').
 * @param {string|Date} dateInput 
 * @returns {Date}
 */
export function parseDateLocal(dateInput = new Date()) {
  if (dateInput instanceof Date) {
    return new Date(dateInput.getTime());
  }
  if (typeof dateInput === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateInput)) {
    const [y, m, d] = dateInput.split('-').map(Number);
    return new Date(y, m - 1, d, 0, 0, 0, 0);
  }
  const parsed = new Date(dateInput);
  return isNaN(parsed.getTime()) ? new Date() : parsed;
}

/**
 * Get date string formatted as YYYY-MM-DD in the user's local timezone
 * @param {Date|string} [date] 
 * @returns {string}
 */
export function getDateString(date = new Date()) {
  const d = parseDateLocal(date);
  if (isNaN(d.getTime())) return '';
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Add days to a given date string or current date using local date arithmetic
 * @param {number} days 
 * @param {string|Date} [baseDate] 
 * @returns {string} YYYY-MM-DD
 */
export function addDays(days, baseDate = new Date()) {
  const d = parseDateLocal(baseDate);
  d.setDate(d.getDate() + days);
  return getDateString(d);
}

export const DEFAULT_SRS_DATA = {
  state: CARD_STATES.NEW,
  interval: 0,       // In days
  easeFactor: 2.5,   // Standard starting ease factor (250%)
  reps: 0,           // Successful consecutive repetitions
  lapses: 0,         // Number of times card was forgotten
  consecutiveGoods: 0, // Number of consecutive good ratings in first review / learning phase
  dueDate: getDateString(), // YYYY-MM-DD in user's local timezone
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
 * Compute the next SRS state and scheduling given a rating (1: Again, 2: Hard, 3: Good, 4: Easy).
 * On first review (new or learning cards), cards need 2 good ratings in a row before graduating/rescheduling.
 * 
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
    lapses: currentSrs.lapses || 0,
    consecutiveGoods: currentSrs.consecutiveGoods || 0
  };

  const isFirstReview = prev.state === CARD_STATES.NEW || prev.interval === 0 || prev.state === CARD_STATES.LEARNING;

  let nextState = prev.state;
  let nextInterval = prev.interval;
  let nextEase = prev.easeFactor;
  let nextReps = prev.reps;
  let nextLapses = prev.lapses;
  let nextConsecutiveGoods = prev.consecutiveGoods;

  if (isFirstReview) {
    // -------------------------------------------------------------
    // First Review / Learning Phase
    // Cards need 2 good ratings in a row before graduating/rescheduling.
    // -------------------------------------------------------------
    if (rating === RATINGS.AGAIN) {
      // Again breaks streak of good ratings, stays in learning today
      nextConsecutiveGoods = 0;
      nextReps = 0;
      nextInterval = 0;
      nextState = CARD_STATES.LEARNING;
    } else if (rating === RATINGS.HARD) {
      // Hard breaks consecutive goods streak, stays in learning today
      nextConsecutiveGoods = 0;
      nextReps = 0;
      nextInterval = 0;
      nextState = CARD_STATES.LEARNING;
    } else if (rating === RATINGS.GOOD) {
      if (prev.consecutiveGoods < 1) {
        // 1st Good rating: needs 1 more Good rating in a row to graduate!
        nextConsecutiveGoods = 1;
        nextReps = 1;
        nextInterval = 0; // Not rescheduled yet (stays due today)
        nextState = CARD_STATES.LEARNING;
      } else {
        // 2nd Good rating in a row: GRADUATES and reschedules for tomorrow!
        nextConsecutiveGoods = 0;
        nextReps = 2;
        nextInterval = 1; // 1 day
        nextState = CARD_STATES.REVIEW;
      }
    } else if (rating === RATINGS.EASY) {
      // Easy immediately graduates the card to 4 days
      nextConsecutiveGoods = 0;
      nextReps = 1;
      nextInterval = 4;
      nextEase = Math.min(3.5, prev.easeFactor + 0.15);
      nextState = CARD_STATES.REVIEW;
    }
  } else {
    // -------------------------------------------------------------
    // Review Phase (Graduated cards with interval >= 1)
    // -------------------------------------------------------------
    if (rating === RATINGS.AGAIN) {
      // LAPSE: Back-off interval, increase lapse count, drop ease factor
      nextLapses += 1;
      nextReps = 0;
      nextInterval = 1; // Back off to 1 day
      nextEase = Math.max(1.3, prev.easeFactor - 0.20);
      nextState = CARD_STATES.RELEARNING;
    } else if (rating === RATINGS.HARD) {
      // HARD: Slower interval increase, slight ease penalty
      nextEase = Math.max(1.3, prev.easeFactor - 0.15);
      nextInterval = Math.max(prev.interval + 1, Math.round(prev.interval * 1.2));
      nextReps += 1;
      nextState = CARD_STATES.REVIEW;
    } else if (rating === RATINGS.GOOD) {
      // GOOD: Standard SM-2 interval progression
      if (prev.interval === 1) {
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
      if (prev.interval <= 1) {
        nextInterval = 5;
        nextReps = 2;
      } else {
        nextInterval = Math.max(prev.interval + 2, Math.round(prev.interval * prev.easeFactor * 1.3));
        nextReps += 1;
      }
      nextState = CARD_STATES.REVIEW;
    }
  }

  const nextDueDate = nextInterval === 0 ? todayStr : addDays(nextInterval, now);

  return {
    state: nextState,
    interval: nextInterval,
    easeFactor: Number(nextEase.toFixed(2)),
    reps: nextReps,
    lapses: nextLapses,
    consecutiveGoods: nextConsecutiveGoods,
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

/**
 * Computes the exact Daily Review Queue as laid out in the 30-day calendar forecast.
 * Introduces up to settings.dailyNewLimit (default 20) new cards per day,
 * plus all review cards due on or before today.
 *
 * @param {Array} reviewItems Array of review items
 * @param {Object} settings User settings (dailyNewLimit, etc.)
 * @param {Array} reviewLogs Historical review logs
 * @param {string} targetDate YYYY-MM-DD
 * @returns {Object} { dueReviewItems, newItemsToday, sessionCards, totalDailyCount, todayNewCount, todayReviewCount, todayNewDone }
 */
export function getDailyReviewQueue(reviewItems = [], settings = {}, reviewLogs = [], targetDate = getDateString()) {
  const todayStr = targetDate || getDateString();
  const dailyNewLimit = settings?.dailyNewLimit || 20;

  const dueReviewItems = [];
  const unlearnedItems = [];

  for (const item of reviewItems) {
    const srs = item.srs || DEFAULT_SRS_DATA;
    const isNew = srs.state === CARD_STATES.NEW || srs.interval === 0;

    if (isNew) {
      unlearnedItems.push(item);
    } else if (isCardDue(item, todayStr)) {
      dueReviewItems.push(item);
    }
  }

  // Count how many new cards were already graduated/completed today in this pool
  const itemCardIds = new Set(reviewItems.map(i => i.parentCard ? i.parentCard.id : i.id));
  const graduatedCardIds = new Set(
    (reviewLogs || [])
      .filter(log => log.date === todayStr && (log.oldInterval || 0) === 0 && (log.newInterval || 0) > 0 && itemCardIds.has(log.cardId))
      .map(log => log.cardId)
  );
  const todayNewDone = graduatedCardIds.size;

  // Capped new items for today
  const newQuota = Math.max(0, Math.min(dailyNewLimit - todayNewDone, unlearnedItems.length));
  const newItemsToday = unlearnedItems.slice(0, newQuota);

  return {
    dueReviewItems,
    newItemsToday,
    sessionCards: [...dueReviewItems, ...newItemsToday],
    totalDailyCount: dueReviewItems.length + newItemsToday.length,
    todayNewCount: newItemsToday.length,
    todayReviewCount: dueReviewItems.length,
    todayNewDone,
    totalUnlearnedRemaining: unlearnedItems.length - newItemsToday.length
  };
}

/**
 * Computes the Endless Practice Queue for uncapped review.
 * Cards cap out once they are all set to be reviewed at a later date (dueDate > todayStr).
 *
 * @param {Array} reviewItems Array of review items
 * @param {string} targetDate YYYY-MM-DD
 * @returns {Object} { sessionCards, totalEligible, totalScheduledFuture, isCappedOut, earliestFutureDueDate }
 */
export function getEndlessQueue(reviewItems = [], targetDate = getDateString()) {
  const todayStr = targetDate || getDateString();
  const eligibleItems = [];
  const futureDates = [];

  for (const item of reviewItems) {
    const srs = item.srs || DEFAULT_SRS_DATA;
    const isNew = srs.state === CARD_STATES.NEW || srs.interval === 0;

    if (isNew) {
      // Unlearned cards are ALL eligible in endless (uncapped)
      eligibleItems.push(item);
    } else if (isCardDue(item, todayStr)) {
      // Cards due today or overdue are eligible
      eligibleItems.push(item);
    } else if (srs.dueDate && srs.dueDate > todayStr) {
      // Already scheduled for a later date
      futureDates.push(srs.dueDate);
    }
  }

  futureDates.sort();

  return {
    sessionCards: eligibleItems,
    totalEligible: eligibleItems.length,
    totalScheduledFuture: futureDates.length,
    isCappedOut: eligibleItems.length === 0 && reviewItems.length > 0,
    earliestFutureDueDate: futureDates[0] || null
  };
}
