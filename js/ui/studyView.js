/**
 * Study View & Review Session Controller
 * Powers Anki-style Daily Spaced Repetition, Endless Practice, and Group Reviews.
 */

import { storage } from '../storage.js';
import { 
  processReview, 
  getRatingPredictions, 
  isCardDue,
  getDailyReviewQueue,
  getEndlessQueue,
  getDateString,
  RATINGS, 
  CARD_STATES 
} from '../srs.js';
import { CARD_TYPES, OCCLUSION_MODES, getReviewItemsForCard, renderClozeText, getClozeNumbers } from '../models.js';
import { renderOcclusionStudyViewer } from '../occlusionCanvas.js';

export class StudyView {
  constructor(container, navigateTo) {
    this.container = container;
    this.navigateTo = navigateTo;
    this.session = null;
    this.keyListener = null;
  }

  async start(options = {}) {
    const { mode = 'daily', groupId = null, includeSubgroups = true, focusedGroupIds = null } = options;

    let allCards;
    let groupName = 'All Decks';

    const settings = await storage.getSettings();
    const activeFocus = focusedGroupIds !== null ? focusedGroupIds : (settings.focusedGroupIds || []);

    if (groupId) {
      allCards = await storage.getCards(groupId, includeSubgroups);
      const g = await storage.getGroup(groupId);
      if (g) groupName = g.name;
    } else {
      if (activeFocus && activeFocus.length > 0) {
        const allowedGroupIds = new Set();
        for (const gid of activeFocus) {
          allowedGroupIds.add(gid);
          const subIds = await storage.getSubgroupIds(gid);
          subIds.forEach(id => allowedGroupIds.add(id));
        }
        allCards = (await storage.getCards()).filter(c => c.groupId && allowedGroupIds.has(c.groupId));

        const groups = await storage.getGroups();
        const focusedNames = groups.filter(g => activeFocus.includes(g.id)).map(g => g.name);
        if (focusedNames.length === 1) {
          groupName = `🎯 Focus: ${focusedNames[0]}`;
        } else if (focusedNames.length > 1) {
          groupName = `🎯 Focus (${focusedNames.length} decks)`;
        }
      } else if (mode === 'daily') {
        // Users NEED to put decks in focus to get a daily set
        allCards = [];
      } else {
        allCards = await storage.getCards();
        groupName = 'All Decks';
      }
    }

    const isNoFocusDaily = mode === 'daily' && !groupId && (!activeFocus || activeFocus.length === 0);

    // Expand cards into reviewable items (1 per box for guess-one occlusion cards)
    const allReviewItems = allCards.flatMap(c => getReviewItemsForCard(c));
    let sessionCards = [];
    let isCappedOutEndless = false;
    let earliestFutureDueDate = null;

    const reviewLogs = await storage.getReviewLogs();
    const todayStr = getDateString();

    if (mode === 'daily') {
      const dailyQueue = getDailyReviewQueue(allReviewItems, settings, reviewLogs, todayStr);
      sessionCards = dailyQueue.sessionCards;
    } else {
      // Endless practice: uncapped review
      const endlessQueue = getEndlessQueue(allReviewItems, todayStr);
      sessionCards = [...endlessQueue.sessionCards].sort(() => Math.random() - 0.5);
      isCappedOutEndless = endlessQueue.isCappedOut;
      earliestFutureDueDate = endlessQueue.earliestFutureDueDate;
    }

    this.session = {
      mode,
      groupId,
      groupName,
      isNoFocusDaily,
      isCappedOutEndless,
      earliestFutureDueDate,
      cards: sessionCards,
      currentIndex: 0,
      isFlipped: false,
      isHintRevealed: false,
      isReverseQuestion: false, // For reversible cards
      stats: {
        total: sessionCards.length,
        again: 0,
        hard: 0,
        good: 0,
        easy: 0,
        startTime: Date.now()
      }
    };

    if (this.session.isNoFocusDaily) {
      document.title = 'Daily Review | StudyCards';
    } else if (this.session.isCappedOutEndless) {
      document.title = 'Endless Practice | StudyCards';
    } else {
      const cleanName = (this.session.groupName || '').replace('🎯 Focus: ', '').replace(/^[^\w\s]+/, '').trim();
      const prefix = this.session.mode === 'endless' ? 'Practice' : 'Review';
      document.title = cleanName ? `${prefix}: ${cleanName} | StudyCards` : `${prefix} | StudyCards`;
    }

    this._renderCurrentCard();
    this._attachKeyListeners();
  }

  destroy() {
    document.body.classList.remove('study-mode-active');
    if (this.keyListener) {
      window.removeEventListener('keydown', this.keyListener);
      this.keyListener = null;
    }
  }

  _attachKeyListeners() {
    if (this.keyListener) {
      window.removeEventListener('keydown', this.keyListener);
      this.keyListener = null;
    }
    this.keyListener = (e) => {
      // Don't capture keys if an input is focused or modal is open
      if (['INPUT', 'TEXTAREA'].includes(e.target.tagName)) return;
      if (document.querySelector('.modal-backdrop:not(.hidden)')) return;

      if (!this.session || this.session.currentIndex >= this.session.cards.length) return;

      if (e.code === 'Space' || e.code === 'Enter') {
        e.preventDefault();
        if (!this.session.isFlipped) {
          this._flipCard();
        }
      } else if (this.session.isFlipped) {
        if (e.key === '1') this._handleRating(RATINGS.AGAIN);
        else if (e.key === '2') this._handleRating(RATINGS.HARD);
        else if (e.key === '3') this._handleRating(RATINGS.GOOD);
        else if (e.key === '4') this._handleRating(RATINGS.EASY);
      }
    };
    window.addEventListener('keydown', this.keyListener);
  }

  _flipCard() {
    this.session.isFlipped = true;
    const currentCard = this.session.cards[this.session.currentIndex];

    if (currentCard.type === CARD_TYPES.IMAGE_OCCLUSION) {
      // In-place reveal: NO 3D flip animation! Reveal occluded region directly in the diagram
      const targetIndex = this.session.targetOcclusionIndex || 0;
      const mode = currentCard.occlusionMode || 'hide_all_guess_one';

      const boxes = this.container.querySelectorAll('.card-face-front .occlusion-study-box');
      boxes.forEach((boxEl) => {
        const boxIdx = Number(boxEl.dataset.boxIndex);
        const isTarget = boxIdx === targetIndex;
        if (mode === 'hide_all_guess_all' || isTarget) {
          boxEl.classList.remove('occ-box-masked');
          boxEl.classList.add('occ-box-revealed');
          const maskContent = boxEl.querySelector('.occ-mask-content');
          if (maskContent) maskContent.remove();
        }
      });

      // Update card header prompts
      const headerPrompt = this.container.querySelector('.card-face-front .card-flip-prompt');
      if (headerPrompt) {
        headerPrompt.textContent = 'Rate your recall';
      }
      const typeIndicator = this.container.querySelector('.card-face-front .card-type-indicator');
      if (typeIndicator) {
        typeIndicator.textContent = 'ANSWER';
      }

      // If card has back extra notes, reveal them
      const backNotes = this.container.querySelector('.card-face-front .occlusion-extra-notes');
      if (backNotes) {
        backNotes.classList.remove('hidden');
      }
    } else {
      // Standard cards: 3D flip animation
      const cardWrapper = this.container.querySelector('.study-card-perspective');
      if (cardWrapper) {
        cardWrapper.classList.add('flipped');
      }
    }

    const actionContainer = this.container.querySelector('#study-action-bar');
    if (actionContainer) {
      actionContainer.innerHTML = this._renderFlippedActions();
      this._wireFlippedActionButtons();
    }
  }

  _renderCurrentCard() {
    if (!this.session || this.session.currentIndex >= this.session.cards.length) {
      this._renderCompletion();
      return;
    }

    document.body.classList.add('study-mode-active');

    const currentCard = this.session.cards[this.session.currentIndex];
    const currentIndex = this.session.currentIndex;
    const total = this.session.cards.length;
    const progressPercent = Math.round((currentIndex / total) * 100);

    this.session.isFlipped = false;
    this.session.isHintRevealed = false;

    // Reversible card: 50% chance to test front->back or back->front
    if (currentCard.type === CARD_TYPES.REVERSIBLE) {
      this.session.isReverseQuestion = Math.random() > 0.5;
    } else {
      this.session.isReverseQuestion = false;
    }

    // Set target occlusion index and cloze number for this card item
    this.session.targetOcclusionIndex = currentCard.targetOcclusionIndex !== undefined
      ? currentCard.targetOcclusionIndex
      : 0;
    this.session.targetClozeNum = currentCard.targetClozeNum !== undefined
      ? currentCard.targetClozeNum
      : 1;

    this.container.innerHTML = `
      <div class="study-arena animate-fade-in">
        <!-- Top Session Header -->
        <header class="study-session-header">
          <button class="btn btn-ghost btn-sm" id="btn-exit-study">
            &larr; Exit Session
          </button>

          <div class="study-session-meta">
            <span class="study-mode-pill pill-${this.session.mode}">
              ${this.session.mode === 'daily' ? 'DAILY REVIEW' : 'ENDLESS PRACTICE'}
            </span>
            <span class="study-group-name">${escapeHtml(this.session.groupName)}</span>
          </div>

          <div class="study-card-counter">
            Card <strong>${currentIndex + 1}</strong> of ${total}
          </div>
        </header>

        <!-- Session Progress Bar -->
        <div class="study-progress-track">
          <div class="study-progress-bar" style="width: ${progressPercent}%;"></div>
        </div>

        <!-- 3D Card Area -->
        <div class="study-card-stage">
          <div class="study-card-perspective ${this.session.isFlipped ? 'flipped' : ''}">
            <div class="study-card-inner">
              <!-- FRONT FACE -->
              <div class="card-face card-face-front">
                <div class="card-face-header">
                  <div style="display: flex; align-items: center; gap: 0.5rem;">
                    <span class="card-type-indicator">${(currentCard.type || 'basic').replace('_', ' ').toUpperCase()}</span>
                    ${currentCard.srs && currentCard.srs.consecutiveGoods === 1 ? `
                      <span class="badge badge-step-learning" title="Rated Good once. Needs 1 more Good rating in a row to graduate to tomorrow!">⭐ 1 of 2 Good</span>
                    ` : ''}
                  </div>
                  <span class="card-flip-prompt">${currentCard.type === CARD_TYPES.IMAGE_OCCLUSION ? 'Click or Press <strong>Space</strong> to Reveal' : 'Click or Press <strong>Space</strong> to Flip'}</span>
                </div>

                <div class="card-face-content">
                  ${this._renderCardFrontContent(currentCard)}
                </div>

                ${currentCard.hint ? `
                  <div class="card-hint-area">
                    <button class="btn-hint-toggle" id="btn-toggle-hint">💡 Show Hint</button>
                    <div class="hint-text hidden" id="card-hint-text">${escapeHtml(currentCard.hint)}</div>
                  </div>
                ` : ''}
              </div>

              ${currentCard.type !== CARD_TYPES.IMAGE_OCCLUSION ? `
                <!-- BACK FACE (for non-occlusion cards) -->
                <div class="card-face card-face-back">
                  <div class="card-face-header">
                    <div style="display: flex; align-items: center; gap: 0.5rem;">
                      <span class="card-type-indicator">ANSWER</span>
                      ${currentCard.srs && currentCard.srs.consecutiveGoods === 1 ? `
                        <span class="badge badge-step-learning" title="Needs 1 more Good rating in a row to graduate!">⭐ 1 of 2 Good</span>
                      ` : ''}
                    </div>
                    <span class="card-flip-prompt">Rate your recall</span>
                  </div>

                  <div class="card-face-content">
                    ${this._renderCardBackContent(currentCard)}
                  </div>
                </div>
              ` : ''}
            </div>
          </div>
        </div>

        <!-- Bottom Controls / Rating Buttons -->
        <footer class="study-action-bar" id="study-action-bar">
          ${this.session.isFlipped ? this._renderFlippedActions() : `
            <button class="btn btn-primary btn-lg btn-flip-action" id="btn-flip-card">
              ${currentCard.type === CARD_TYPES.IMAGE_OCCLUSION ? 'Reveal Answer (Space)' : 'Show Answer (Space)'}
            </button>
          `}
        </footer>
      </div>
    `;

    // Wire buttons
    const btnExit = this.container.querySelector('#btn-exit-study');
    if (btnExit) {
      btnExit.addEventListener('click', () => {
        this.destroy();
        this.navigateTo('dashboard');
      });
    }

    const cardPerspective = this.container.querySelector('.study-card-perspective');
    if (cardPerspective) {
      cardPerspective.addEventListener('click', (e) => {
        if (e.target.closest('#btn-toggle-hint')) return;
        if (!this.session.isFlipped) {
          this._flipCard();
        }
      });
    }

    const btnFlip = this.container.querySelector('#btn-flip-card');
    if (btnFlip) {
      btnFlip.addEventListener('click', () => this._flipCard());
    }

    const btnHint = this.container.querySelector('#btn-toggle-hint');
    const hintText = this.container.querySelector('#card-hint-text');
    if (btnHint && hintText) {
      btnHint.addEventListener('click', (e) => {
        e.stopPropagation();
        hintText.classList.toggle('hidden');
        btnHint.textContent = hintText.classList.contains('hidden') ? '💡 Show Hint' : '💡 Hide Hint';
      });
    }

    if (this.session.isFlipped) {
      this._wireFlippedActionButtons();
    }
  }

  _renderCardFrontContent(card) {
    if (card.type === CARD_TYPES.CLOZE) {
      const mode = card.clozeMode || OCCLUSION_MODES.HIDE_ALL_GUESS_ONE;
      const targetClozeNum = card.targetClozeNum !== undefined ? card.targetClozeNum : (this.session.targetClozeNum || 1);
      const clozeNums = getClozeNumbers(card.clozeText || card.front);
      const totalClozes = clozeNums.length;

      let modeDescription = 'Recall the missing term in [ ... ]';
      if (mode === OCCLUSION_MODES.HIDE_ALL_GUESS_ALL) {
        modeDescription = 'Recall all hidden blanks in the passage';
      } else if (mode === OCCLUSION_MODES.HIDE_ONE_GUESS_ONE) {
        modeDescription = 'Only the target blank is hidden. Use surrounding text as context!';
      } else if (mode === OCCLUSION_MODES.HIDE_ALL_GUESS_ONE) {
        modeDescription = 'All blanks are covered. Identify the active target [ ? ... ]';
      }

      const masked = renderClozeText(card.clozeText || card.front, false, targetClozeNum, mode);
      return `
        <div class="cloze-prompt-box">
          <p class="study-text cloze-text">${masked}</p>
          <p class="study-hint-note" style="margin-top: 1.25rem;">
            ${modeDescription}
            ${(mode !== OCCLUSION_MODES.HIDE_ALL_GUESS_ALL && totalClozes > 1) ? `
              <span style="display: block; margin-top: 4px; font-weight: 600; color: var(--primary);">
                Testing Blank c${targetClozeNum} (${clozeNums.indexOf(targetClozeNum) + 1} of ${totalClozes})
              </span>
            ` : ''}
          </p>
        </div>
      `;
    }

    if (card.type === CARD_TYPES.IMAGE_OCCLUSION) {
      const mode = card.occlusionMode || 'hide_all_guess_one';
      const targetIndex = this.session.targetOcclusionIndex || 0;
      const totalBoxes = (card.imageOcclusions || []).length;

      let modeDescription = 'Identify the diagram label marked with ?';
      if (mode === 'hide_all_guess_all') {
        modeDescription = 'Recall all hidden areas on the diagram';
      } else if (mode === 'hide_one_guess_one') {
        modeDescription = 'Only the target label is hidden. Use surrounding labels as hints!';
      }

      return `
        <div class="occlusion-prompt-wrapper">
          <h3 class="study-heading">${escapeHtml(card.front)}</h3>
          ${renderOcclusionStudyViewer(card, false, targetIndex)}
          <p class="study-hint-note">
            ${modeDescription}
            ${(mode !== 'hide_all_guess_all' && totalBoxes > 1) ? `
              <span style="display: block; margin-top: 4px; font-weight: 600; color: var(--primary);">
                Testing Area ${targetIndex + 1} of ${totalBoxes}
              </span>
            ` : ''}
          </p>
          ${card.back ? `<p class="study-hint-note occlusion-extra-notes hidden" style="margin-top: 6px;">${escapeHtml(card.back)}</p>` : ''}
        </div>
      `;
    }

    if (card.type === CARD_TYPES.IMAGE) {
      return `
        <div class="image-card-prompt">
          <h3 class="study-heading">${escapeHtml(card.front)}</h3>
          ${card.imageUrl ? `<img src="${card.imageUrl}" alt="Question Image" class="study-image-media"/>` : ''}
        </div>
      `;
    }

    if (card.type === CARD_TYPES.REVERSIBLE && this.session.isReverseQuestion) {
      return `
        <div class="text-card-prompt">
          <span class="reverse-badge">Reversed Prompt</span>
          <p class="study-text">${escapeHtml(card.back)}</p>
        </div>
      `;
    }

    return `
      <div class="text-card-prompt">
        <p class="study-text">${escapeHtml(card.front)}</p>
      </div>
    `;
  }

  _renderCardBackContent(card) {
    if (card.type === CARD_TYPES.CLOZE) {
      const mode = card.clozeMode || OCCLUSION_MODES.HIDE_ALL_GUESS_ONE;
      const targetClozeNum = card.targetClozeNum !== undefined ? card.targetClozeNum : (this.session.targetClozeNum || 1);
      const revealed = renderClozeText(card.clozeText || card.front, true, targetClozeNum, mode);
      return `
        <div class="cloze-answer-box">
          <p class="study-text cloze-text">${revealed}</p>
          ${card.back ? `<div class="cloze-extra-notes">${escapeHtml(card.back)}</div>` : ''}
        </div>
      `;
    }

    if (card.type === CARD_TYPES.IMAGE_OCCLUSION) {
      const targetIndex = this.session.targetOcclusionIndex || 0;
      return `
        <div class="occlusion-answer-wrapper">
          <h3 class="study-heading">${escapeHtml(card.front)}</h3>
          ${renderOcclusionStudyViewer(card, true, targetIndex)}
          ${card.back ? `<p class="study-hint-note" style="margin-top: 6px;">${escapeHtml(card.back)}</p>` : ''}
        </div>
      `;
    }

    if (card.type === CARD_TYPES.IMAGE) {
      return `
        <div class="image-card-answer">
          ${card.imageUrl ? `<img src="${card.imageUrl}" alt="Answer Image" class="study-image-media study-image-thumb"/>` : ''}
          <div class="answer-text-highlight">${escapeHtml(card.back)}</div>
        </div>
      `;
    }

    if (card.type === CARD_TYPES.REVERSIBLE && this.session.isReverseQuestion) {
      return `
        <div class="text-card-answer">
          <div class="answer-text-highlight">${escapeHtml(card.front)}</div>
        </div>
      `;
    }

    return `
      <div class="text-card-answer">
        <div class="answer-text-highlight">${escapeHtml(card.back)}</div>
      </div>
    `;
  }

  _renderFlippedActions() {
    const currentCard = this.session.cards[this.session.currentIndex];
    const predictions = getRatingPredictions(currentCard.srs);

    return `
      <div class="anki-ratings-group">
        <button class="btn-srs-rating rating-again" data-rating="${RATINGS.AGAIN}">
          <span class="rating-interval">${predictions[RATINGS.AGAIN].intervalText}</span>
          <span class="rating-name">Again</span>
          <span class="rating-key">[1]</span>
        </button>

        <button class="btn-srs-rating rating-hard" data-rating="${RATINGS.HARD}">
          <span class="rating-interval">${predictions[RATINGS.HARD].intervalText}</span>
          <span class="rating-name">Hard</span>
          <span class="rating-key">[2]</span>
        </button>

        <button class="btn-srs-rating rating-good" data-rating="${RATINGS.GOOD}">
          <span class="rating-interval">${predictions[RATINGS.GOOD].intervalText}</span>
          <span class="rating-name">Good</span>
          <span class="rating-key">[3]</span>
        </button>

        <button class="btn-srs-rating rating-easy" data-rating="${RATINGS.EASY}">
          <span class="rating-interval">${predictions[RATINGS.EASY].intervalText}</span>
          <span class="rating-name">Easy</span>
          <span class="rating-key">[4]</span>
        </button>
      </div>
    `;
  }

  _wireFlippedActionButtons() {
    this.container.querySelectorAll('.btn-srs-rating').forEach(btn => {
      btn.onclick = () => {
        const rating = Number(btn.dataset.rating);
        this._handleRating(rating);
      };
    });
  }

  async _handleRating(rating) {
    const currentItem = this.session.cards[this.session.currentIndex];
    const oldSrs = { ...currentItem.srs };
    const newSrs = processReview(currentItem.srs, rating);

    // Save updated SRS on this review item
    currentItem.srs = newSrs;

    // Save updated SRS on parent card in storage
    const parentId = currentItem.parentCard ? currentItem.parentCard.id : currentItem.id;
    const parentCard = (await storage.getCard(parentId)) || currentItem.parentCard || currentItem;

    if (currentItem.targetBoxId) {
      parentCard.boxSrs = parentCard.boxSrs || {};
      parentCard.boxSrs[currentItem.targetBoxId] = newSrs;

      // Update parentCard.srs with state and earliest dueDate among all its boxes
      const allDueDates = Object.values(parentCard.boxSrs).map(s => s.dueDate).filter(Boolean);
      if (allDueDates.length > 0) {
        allDueDates.sort();
        parentCard.srs = {
          ...(parentCard.srs || {}),
          state: newSrs.state,
          interval: Math.max(parentCard.srs?.interval || 0, newSrs.interval),
          dueDate: allDueDates[0]
        };
      }
    } else if (currentItem.targetClozeNum !== undefined) {
      parentCard.clozeSrs = parentCard.clozeSrs || {};
      parentCard.clozeSrs[`c${currentItem.targetClozeNum}`] = newSrs;

      // Update parentCard.srs with state and earliest dueDate among all its clozes
      const allDueDates = Object.values(parentCard.clozeSrs).map(s => s.dueDate).filter(Boolean);
      if (allDueDates.length > 0) {
        allDueDates.sort();
        parentCard.srs = {
          ...(parentCard.srs || {}),
          state: newSrs.state,
          interval: Math.max(parentCard.srs?.interval || 0, newSrs.interval),
          dueDate: allDueDates[0]
        };
      }
    } else {
      parentCard.srs = newSrs;
    }

    await storage.saveCard(parentCard);
    await storage.logReview(parentCard.id, rating, oldSrs, newSrs);

    // Track stats
    if (rating === RATINGS.AGAIN) {
      this.session.stats.again++;
    } else if (rating === RATINGS.HARD) {
      this.session.stats.hard++;
    } else if (rating === RATINGS.GOOD) {
      this.session.stats.good++;
    } else if (rating === RATINGS.EASY) {
      this.session.stats.easy++;
    }

    // Re-queue card if not yet rescheduled into the future:
    // (e.g. On first review, cards need 2 good ratings in a row before graduating/rescheduling, or if rated Again/Hard)
    if (newSrs.interval === 0) {
      this.session.cards.push(currentItem);
    }

    this.session.currentIndex++;
    this._renderCurrentCard();
  }

  _renderCompletion() {
    this.destroy();
    document.title = 'Session Complete | StudyCards';

    // 1. No Focus Set (Daily Mode)
    if (this.session && this.session.isNoFocusDaily) {
      this.container.innerHTML = `
        <div class="completion-screen animate-scale-up">
          <div class="completion-card">
            <div class="completion-badge-icon">🎯</div>
            <h2 class="completion-title">No Decks in Focus</h2>
            <p class="completion-subtitle">
              You need to put decks in focus to generate a daily review set. Select which Classes, Units, or Lessons to focus on from your dashboard.
            </p>
            <div class="completion-actions" style="justify-content: center;">
              <button class="btn btn-primary btn-lg" id="btn-comp-dashboard">
                Return to Dashboard &amp; Set Focus
              </button>
            </div>
          </div>
        </div>
      `;
      const btnDash = this.container.querySelector('#btn-comp-dashboard');
      if (btnDash) {
        btnDash.addEventListener('click', () => this.navigateTo('dashboard'));
      }
      return;
    }

    // 2. Endless Capped Out (All cards scheduled for a future date)
    if (this.session && this.session.mode === 'endless' && (this.session.isCappedOutEndless || this.session.cards.length === 0)) {
      this.container.innerHTML = `
        <div class="completion-screen animate-scale-up">
          <div class="completion-card">
            <div class="completion-badge-icon">🎯</div>
            <h2 class="completion-title">All Caught Up in Endless Practice!</h2>
            <p class="completion-subtitle">
              All cards in <strong>${escapeHtml(this.session.groupName)}</strong> are already scheduled for review at a later date.
              ${this.session.earliestFutureDueDate ? `<br><span style="display:inline-block; margin-top:8px; font-weight:600; color:var(--primary);">Earliest review scheduled for: ${this.session.earliestFutureDueDate}</span>` : ''}
            </p>
            <p style="color: var(--text-muted); font-size: 0.9rem; margin-top: 0.5rem;">
              To review all these cards again right now, you can reset their review progress in Folders &amp; Decks or reset below.
            </p>
            <div class="completion-actions" style="margin-top: 1.5rem; display: flex; flex-wrap: wrap; gap: 0.75rem; justify-content: center;">
              <button class="btn btn-warning btn-lg" id="btn-comp-reset-progress">
                🔄 Reset Review Progress &amp; Study Again
              </button>
              <button class="btn btn-outline btn-lg" id="btn-comp-decks">
                📁 View Folders &amp; Decks
              </button>
              <button class="btn btn-ghost btn-lg" id="btn-comp-dashboard">
                Back to Dashboard
              </button>
            </div>
          </div>
        </div>
      `;

      this._wireCompletionNavigation();
      return;
    }

    // 3. Daily Completed with 0 Cards Initially Due
    if (this.session && this.session.mode === 'daily' && this.session.stats.total === 0) {
      this.container.innerHTML = `
        <div class="completion-screen animate-scale-up">
          <div class="completion-card">
            <div class="completion-badge-icon">🎉</div>
            <h2 class="completion-title">All Caught Up for Today!</h2>
            <p class="completion-subtitle">
              You've completed all your scheduled daily reviews for <strong>${escapeHtml(this.session.groupName)}</strong>.
            </p>
            <div class="completion-actions" style="margin-top: 1.5rem; display: flex; flex-wrap: wrap; gap: 0.75rem; justify-content: center;">
              <button class="btn btn-primary btn-lg" id="btn-comp-endless">
                Keep Practicing (Endless Mode)
              </button>
              <button class="btn btn-outline btn-lg" id="btn-comp-dashboard">
                Back to Dashboard
              </button>
            </div>
          </div>
        </div>
      `;

      this._wireCompletionNavigation();
      return;
    }

    // 4. Session Just Finished With Reviews
    const stats = this.session.stats;
    const durationMins = Math.max(1, Math.round((Date.now() - stats.startTime) / 60000));
    const totalAnswers = stats.again + stats.hard + stats.good + stats.easy;
    const accuracy = totalAnswers > 0 
      ? Math.round(((stats.good + stats.easy) / totalAnswers) * 100) 
      : 100;

    const isDaily = this.session.mode === 'daily';

    this.container.innerHTML = `
      <div class="completion-screen animate-scale-up">
        <canvas id="confetti-canvas" style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none; z-index: 10;"></canvas>

        <div class="completion-card">
          <div class="completion-badge-icon">🎉</div>
          <h2 class="completion-title">${isDaily ? 'Outstanding Work!' : 'Practice Session Complete!'}</h2>
          <p class="completion-subtitle">
            You've completed your <strong>${isDaily ? 'Daily Review' : 'Endless Practice'}</strong> for ${escapeHtml(this.session.groupName)}.
            ${!isDaily ? '<br><span style="font-size:0.9rem; color:var(--text-muted);">All cards reviewed have been scheduled into future dates.</span>' : ''}
          </p>

          <div class="completion-stats-grid">
            <div class="comp-stat-box">
              <span class="comp-stat-num">${stats.total}</span>
              <span class="comp-stat-label">Cards Reviewed</span>
            </div>

            <div class="comp-stat-box">
              <span class="comp-stat-num">${accuracy}%</span>
              <span class="comp-stat-label">Accuracy Rate</span>
            </div>

            <div class="comp-stat-box">
              <span class="comp-stat-num">${durationMins}m</span>
              <span class="comp-stat-label">Study Time</span>
            </div>
          </div>

          <div class="completion-actions" style="margin-top: 1.5rem; display: flex; flex-wrap: wrap; gap: 0.75rem; justify-content: center;">
            <button class="btn btn-primary btn-lg" id="btn-comp-dashboard">
              Back to Dashboard
            </button>
            ${isDaily ? `
              <button class="btn btn-outline btn-lg" id="btn-comp-endless">
                Keep Practicing (Endless Mode)
              </button>
            ` : `
              <button class="btn btn-outline btn-lg" id="btn-comp-decks">
                📁 Folders &amp; Decks
              </button>
              <button class="btn btn-warning btn-lg" id="btn-comp-reset-progress">
                🔄 Reset &amp; Practice Again
              </button>
            `}
          </div>
        </div>
      </div>
    `;

    this._launchConfetti();
    this._wireCompletionNavigation();
  }

  _wireCompletionNavigation() {
    const btnDash = this.container.querySelector('#btn-comp-dashboard');
    if (btnDash) {
      btnDash.addEventListener('click', () => this.navigateTo('dashboard'));
    }

    const btnDecks = this.container.querySelector('#btn-comp-decks');
    if (btnDecks) {
      btnDecks.addEventListener('click', () => this.navigateTo('decks'));
    }

    const btnEndless = this.container.querySelector('#btn-comp-endless');
    if (btnEndless) {
      btnEndless.addEventListener('click', () => {
        this.start({ mode: 'endless', groupId: this.session.groupId });
      });
    }

    const btnReset = this.container.querySelector('#btn-comp-reset-progress');
    if (btnReset) {
      btnReset.addEventListener('click', async () => {
        if (confirm(`Reset review progress for "${this.session.groupName}"? All cards will be returned to the review queues as new cards.`)) {
          if (this.session.groupId) {
            await storage.resetReviewData(this.session.groupId, true);
          } else {
            const settings = await storage.getSettings();
            if (settings.focusedGroupIds?.length > 0) {
              for (const gid of settings.focusedGroupIds) {
                await storage.resetReviewData(gid, true);
              }
            } else {
              await storage.resetReviewData(null, true);
            }
          }
          window.dispatchEvent(new CustomEvent('groups-updated'));
          this.start({ mode: 'endless', groupId: this.session.groupId });
        }
      });
    }
  }

  _launchConfetti() {
    const canvas = this.container.querySelector('#confetti-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    const pieces = [];
    const colors = ['#c05638', '#38734e', '#b87320', '#b83a3a', '#e07a57', '#d99436'];

    for (let i = 0; i < 90; i++) {
      pieces.push({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height - canvas.height,
        size: Math.random() * 8 + 4,
        color: colors[Math.floor(Math.random() * colors.length)],
        velX: (Math.random() - 0.5) * 3,
        velY: Math.random() * 4 + 2,
        rot: Math.random() * 360,
        rotSpeed: (Math.random() - 0.5) * 5
      });
    }

    let frameCount = 0;
    const animate = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      for (const p of pieces) {
        p.x += p.velX;
        p.y += p.velY;
        p.rot += p.rotSpeed;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate((p.rot * Math.PI) / 180);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
        ctx.restore();
      }
      frameCount++;
      if (frameCount < 160) {
        requestAnimationFrame(animate);
      } else {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      }
    };
    animate();
  }
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
