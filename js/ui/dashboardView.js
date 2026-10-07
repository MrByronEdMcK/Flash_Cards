/**
 * Dashboard View
 * Directs secondary students to their Daily review, shows streaks with live reset countdown,
 * your classes & subjects, stat cards, and 30-day forecast stacked bar chart (pixel-perfect CSS Grid).
 * 
 * Note: Users NEED to put decks in focus to get a daily set. If no deck is in focus,
 * the area regarding cards due for review prompts the user to put decks in focus.
 */

import { storage } from '../storage.js';
import { isCardDue, getDailyReviewQueue } from '../srs.js';
import { getCardCount, getDueCountForCard, getReviewItemsForCard } from '../models.js';

export async function renderDashboard(container, navigateTo) {
  // Clear any existing timer interval
  if (window.__streakTimerInterval) {
    clearInterval(window.__streakTimerInterval);
    window.__streakTimerInterval = null;
  }

  // Clean up any existing focus modal attached to document.body
  const existingModal = document.getElementById('focus-hierarchy-modal');
  if (existingModal) {
    existingModal.remove();
  }

  const cards = await storage.getCards();
  const groups = await storage.getGroups();
  const settings = await storage.getSettings();
  const reviewLogs = await storage.getReviewLogs();

  const focusedGroupIds = Array.isArray(settings.focusedGroupIds) ? settings.focusedGroupIds : [];
  const isFocusActive = focusedGroupIds.length > 0;

  // Build group lookup map
  const groupMap = new Map(groups.map(g => [g.id, g]));

  // Helper: synchronous sub-group collector for quick resolution
  function getSubgroupIdsSync(groupId) {
    const res = new Set();
    const findChildren = (pid) => {
      for (const g of groups) {
        if (g.parentId === pid && !res.has(g.id)) {
          res.add(g.id);
          findChildren(g.id);
        }
      }
    };
    findChildren(groupId);
    return res;
  }

  // Determine allowed group IDs when focus is active
  let allowedGroupIds = null;
  if (isFocusActive) {
    allowedGroupIds = new Set();
    for (const gid of focusedGroupIds) {
      allowedGroupIds.add(gid);
      const subs = getSubgroupIdsSync(gid);
      subs.forEach(id => allowedGroupIds.add(id));
    }
  }

  // Filter cards by active focus.
  // Rule: Users NEED to put decks in focus to get a daily set.
  // If no deck is in focus, active cards for daily review is empty.
  const activeCards = isFocusActive
    ? cards.filter(c => c.groupId && allowedGroupIds.has(c.groupId))
    : [];

  // Expand into individual reviewable items (multi-box occlusion & multi-number cloze)
  const activeReviewItems = activeCards.flatMap(c => getReviewItemsForCard(c));
  const activeCardIds = new Set(activeCards.map(c => c.id));

  // -------------------------------------------------------------
  // Calculate 30-Day Calendar & Forecast (31 Days: -5 to +25)
  // -------------------------------------------------------------
  const now = new Date();
  const todayStr = now.toISOString().split('T')[0];

  // Logs for cards in focus (or general logs if no focus active)
  const focusedLogs = isFocusActive
    ? (reviewLogs || []).filter(log => activeCardIds.has(log.cardId))
    : (reviewLogs || []);

  // Compute daily review queue via SRS engine (caps new cards at daily limit, e.g. 20/day)
  const dailyQueue = isFocusActive
    ? getDailyReviewQueue(activeReviewItems, settings, focusedLogs, todayStr)
    : { totalDailyCount: 0, todayNewCount: 0, todayReviewCount: 0, todayNewDone: 0 };

  // Compute counts for Hero & Badges based on active focus
  const totalCards = activeCards.reduce((sum, c) => sum + getCardCount(c), 0);
  const totalDueCards = dailyQueue.totalDailyCount;
  const reviewCards = activeCards.filter(c => c.srs && c.srs.state === 'review');

  const targetDailyGoal = settings.dailyNewLimit || 20;
  const cardsReviewedToday = settings.cardsReviewedToday || 0;
  const progressPercent = Math.min(100, Math.round((cardsReviewedToday / targetDailyGoal) * 100));

  // Root groups (Classes)
  const rootGroups = groups
    .filter(g => !g.parentId)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

  // Unlearned items in focus: no SRS, state === 'new', or interval === 0
  const unlearnedItems = activeReviewItems.filter(item => 
    !item.srs || item.srs.state === 'new' || item.srs.interval === 0
  );

  // New & Review cards completed today so far
  const todayNewDone = dailyQueue.todayNewDone;
  const todayReviewDone = focusedLogs.filter(log => log.date === todayStr && (log.oldInterval || 0) > 0).length;

  // Remaining new cards to introduce today (capped by daily limit and unlearned pool)
  const todayNewRemaining = dailyQueue.todayNewCount;

  // Remaining due review items for today (excluding unlearned cards)
  const todayReviewRemaining = dailyQueue.todayReviewCount;

  // -------------------------------------------------------------
  // Forward Simulation Engine (Assuming "Good" responses)
  // -------------------------------------------------------------
  // Queue of remaining unlearned items for future days
  let unlearnedQueue = isFocusActive ? unlearnedItems.slice(todayNewRemaining) : [];

  // Active simulated review pool for forward projection
  // Each entry has: { interval: number, easeFactor: number, dueOffset: number }
  const simulatedReviewPool = [];

  if (isFocusActive) {
    // 1. New cards introduced today (completed today + remaining today):
    // When reviewed with "Good", their interval becomes 1 day, due tomorrow (offset 1).
    const totalTodayNew = todayNewDone + todayNewRemaining;
    for (let i = 0; i < totalTodayNew; i++) {
      simulatedReviewPool.push({
        interval: 1,
        easeFactor: 2.5,
        dueOffset: 1
      });
    }

    // 2. Existing review cards due today (completed today + remaining today):
    // When reviewed today with "Good", their interval advances:
    // If old interval <= 1 -> 3. Else max(old + 1, round(old * ease)).
    const dueTodayItems = activeReviewItems.filter(item => 
      item.srs && item.srs.state !== 'new' && item.srs.interval > 0 && isCardDue(item, todayStr)
    );
    for (const item of dueTodayItems) {
      const oldInterval = item.srs.interval || 1;
      const ease = item.srs.easeFactor || 2.5;
      const nextInterval = oldInterval <= 1 ? 3 : Math.max(oldInterval + 1, Math.round(oldInterval * ease));
      simulatedReviewPool.push({
        interval: nextInterval,
        easeFactor: ease,
        dueOffset: nextInterval
      });
    }

    // 3. Existing review cards that have a real future dueDate (> today):
    const futureDueItems = activeReviewItems.filter(item => 
      item.srs && item.srs.state !== 'new' && item.srs.interval > 0 && item.srs.dueDate && item.srs.dueDate > todayStr
    );
    for (const item of futureDueItems) {
      const targetDate = new Date(item.srs.dueDate + 'T00:00:00');
      const todayDate = new Date(todayStr + 'T00:00:00');
      const diffDays = Math.max(1, Math.round((targetDate - todayDate) / (1000 * 60 * 60 * 24)));
      simulatedReviewPool.push({
        interval: item.srs.interval || 1,
        easeFactor: item.srs.easeFactor || 2.5,
        dueOffset: diffDays
      });
    }
  }

  // Pre-calculate future days (1 to 25) step by step
  const futureDaysSimulation = {};
  for (let offset = 1; offset <= 25; offset++) {
    if (!isFocusActive) {
      futureDaysSimulation[offset] = { newCount: 0, reviewCount: 0 };
      continue;
    }

    // A. Introduce new cards consistently up to targetDailyGoal
    const newIntroduced = Math.min(targetDailyGoal, unlearnedQueue.length);
    unlearnedQueue = unlearnedQueue.slice(newIntroduced);

    // Each new card introduced on day 'offset' gets simulated as "Good":
    // Interval = 1 day, next due on offset + 1!
    for (let i = 0; i < newIntroduced; i++) {
      simulatedReviewPool.push({
        interval: 1,
        easeFactor: 2.5,
        dueOffset: offset + 1
      });
    }

    // B. Find all reviews scheduled for day 'offset'
    const dueReviews = simulatedReviewPool.filter(r => r.dueOffset === offset);
    const reviewCount = dueReviews.length;

    // Simulate "Good" response for each review due today:
    for (const r of dueReviews) {
      const nextInterval = r.interval <= 1 ? 3 : Math.max(r.interval + 1, Math.round(r.interval * r.easeFactor));
      r.interval = nextInterval;
      r.dueOffset = offset + nextInterval;
    }

    futureDaysSimulation[offset] = {
      newCount: newIntroduced,
      reviewCount: reviewCount
    };
  }

  const daysData = [];
  for (let offset = -5; offset <= 25; offset++) {
    const dateObj = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
    const dateStr = dateObj.toISOString().split('T')[0];
    
    let newCount = 0;
    let reviewCount = 0;
    let statusLabel = '';

    if (offset < 0) {
      // Past days: based on actual review logs
      const dayLogs = focusedLogs.filter(l => l.date === dateStr);
      newCount = dayLogs.filter(l => (l.oldInterval || 0) === 0).length;
      reviewCount = dayLogs.filter(l => (l.oldInterval || 0) > 0).length;
      statusLabel = `${Math.abs(offset)} days ago`;
    } else if (offset === 0) {
      // Today: completed + pending remaining in focus
      newCount = todayNewDone + todayNewRemaining;
      reviewCount = todayReviewDone + todayReviewRemaining;
      statusLabel = 'Today';
    } else {
      // Future days: forward simulation
      const sim = futureDaysSimulation[offset] || { newCount: 0, reviewCount: 0 };
      newCount = sim.newCount;
      reviewCount = sim.reviewCount;
      statusLabel = offset === 1 ? 'Tomorrow' : `In ${offset} days`;
    }

    const dayName = dateObj.toLocaleDateString(undefined, { weekday: 'short' });
    const dayNum = dateObj.getDate();
    const monthName = dateObj.toLocaleDateString(undefined, { month: 'short' });

    daysData.push({
      offset,
      dateStr,
      dateObj,
      dayName,
      dayNum,
      monthName,
      newCount,
      reviewCount,
      totalCount: newCount + reviewCount,
      isPast: offset < 0,
      isToday: offset === 0,
      isFuture: offset > 0,
      statusLabel
    });
  }

  // Summary Metrics
  const past5Completed = daysData.filter(d => d.isPast).reduce((s, d) => s + d.totalCount, 0);
  const future25Projected = daysData.filter(d => d.isFuture).reduce((s, d) => s + d.totalCount, 0);
  const dailyAverage = Math.round((future25Projected / 25) * 10) / 10;
  
  // Dynamic vertical scaling: tallest day bar scales to fill available height
  const maxDayCount = Math.max(...daysData.map(d => d.totalCount), 0);
  const dynamicScaleMax = maxDayCount > 0 ? maxDayCount : 1;
  const availableBarHeightPx = 160;

  // -------------------------------------------------------------
  // Focus Summary Display
  // -------------------------------------------------------------
  let focusSummaryHtml = '';
  if (!isFocusActive) {
    focusSummaryHtml = `<span class="focus-subtitle focus-prompt-highlight">⚠️ No decks in focus. Set decks in focus to generate your daily review set.</span>`;
  } else {
    focusSummaryHtml = `
      <div class="focus-tags">
        ${focusedGroupIds.map(gid => {
          const g = groupMap.get(gid);
          const name = g ? g.name : 'Deck';
          return `
            <span class="focus-tag">
              🎯 ${escapeHtml(name)}
              <span class="focus-tag-remove" data-remove-id="${gid}" title="Remove focus">&times;</span>
            </span>
          `;
        }).join('')}
      </div>
    `;
  }

  // -------------------------------------------------------------
  // Render Dashboard HTML
  // Swapped Order: Hero -> Focus Filter -> Classes & Subjects -> Stats Grid -> 30-Day Graph
  // -------------------------------------------------------------
  container.innerHTML = `
    <div class="dashboard-page animate-fade-in">
      <!-- 1. Top Hero Banner: Daily Review Call to Action / Focus Prompt -->
      <section class="hero-banner">
        <div class="hero-content">
          ${!isFocusActive ? `
            <!-- Prompt User to Put Decks in Focus (No Deck in Focus) -->
            <div class="hero-badge hero-badge-prompt">
              <span class="pulse-dot pulse-warning"></span>
              Focus Required to Study
            </div>
            <h1 class="hero-title">
              Put decks in focus to get your daily review set
            </h1>
            <p class="hero-subtitle">
              You need to put decks in focus to generate a daily review set. Select which Classes, Units, or Lessons to focus on today. Only cards in focused decks are scheduled for review.
            </p>
            <div class="hero-actions">
              <button class="btn btn-primary btn-lg" id="btn-hero-select-focus">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="22" y1="12" x2="18" y2="12"></line><line x1="6" y1="12" x2="2" y2="12"></line><line x1="12" y1="6" x2="12" y2="2"></line><line x1="12" y1="22" x2="12" y2="18"></line></svg>
                Set Decks in Focus
              </button>
              <button class="btn btn-secondary btn-lg" id="btn-new-card-quick">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                Create New Card
              </button>
            </div>
          ` : `
            <!-- Decks are in focus: Show cards ready for review -->
            <div class="hero-badge">
              <span class="pulse-dot"></span>
              Daily Spaced Repetition • In Focus
            </div>
            <h1 class="hero-title">
              ${totalDueCards > 0 
                ? `You have <span class="highlight-count">${totalDueCards}</span> cards ready for review today!` 
                : `All caught up for today! 🎉`}
            </h1>
            <p class="hero-subtitle">
              ${totalDueCards > 0 
                ? 'Reviewing every day locks concepts into your long-term memory using spaced repetition.'
                : 'Great work on your focused decks! You can continue with Endless Practice or adjust your focused decks.'}
            </p>
            <div class="hero-actions">
              ${totalDueCards > 0 ? `
                <button class="btn btn-primary btn-lg" id="btn-start-daily">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
                  Start Daily Review (${totalDueCards} due)
                </button>
                <button class="btn btn-outline btn-lg" id="btn-start-endless-all">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18.178 8c5.096 0 5.096 8 0 8-5.095 0-7.133-8-12.739-8-4.585 0-4.585 8 0 8 5.606 0 7.644-8 12.739-8z"></path></svg>
                  Endless Practice
                </button>
              ` : `
                <button class="btn btn-primary btn-lg" id="btn-start-endless-all">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18.178 8c5.096 0 5.096 8 0 8-5.095 0-7.133-8-12.739-8-4.585 0-4.585 8 0 8 5.606 0 7.644-8 12.739-8z"></path></svg>
                  Endless Practice
                </button>
              `}
              <button class="btn btn-secondary btn-lg" id="btn-new-card-quick">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                Create New Card
              </button>
            </div>
          `}
        </div>

        <!-- Daily Streak & Goal Box with Device Clock Countdown -->
        <div class="hero-stats-card">
          <div class="streak-widget">
            <div class="streak-icon-wrap">
              <span class="streak-fire-emoji">🔥</span>
            </div>
            <div>
              <div class="streak-value">${settings.streak || 1} Day Streak</div>
              <div class="streak-sub">Keep the momentum going!</div>
              <div class="streak-reset-timer" title="Time remaining until daily streak resets">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
                <span>Reset in <strong id="streak-reset-countdown">--h --m --s</strong></span>
              </div>
            </div>
          </div>

          <div class="daily-progress-widget">
            <div class="progress-info-row">
              <span class="progress-label">Today's Goal</span>
              <span class="progress-count">${cardsReviewedToday} / ${targetDailyGoal} cards</span>
            </div>
            <div class="progress-bar-track">
              <div class="progress-bar-fill" style="width: ${progressPercent}%;"></div>
            </div>
            <div class="progress-footer">
              ${progressPercent >= 100 
                ? '⭐ Daily goal achieved! Outstanding!' 
                : `${Math.max(0, targetDailyGoal - cardsReviewedToday)} more cards to reach your daily goal`}
            </div>
          </div>
        </div>
      </section>

      <!-- 2. Focus Control Bar -->
      <section class="focus-control-bar">
        <div class="focus-control-left">
          <span class="focus-icon-target">🎯</span>
          <div class="focus-info">
            <span class="focus-title">Study Focus Filter</span>
            ${focusSummaryHtml}
          </div>
        </div>
        <div class="focus-control-actions">
          <button class="btn ${isFocusActive ? 'btn-secondary' : 'btn-primary'} btn-sm" id="btn-open-focus-modal">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="22" y1="12" x2="18" y2="12"></line><line x1="6" y1="12" x2="2" y2="12"></line><line x1="12" y1="6" x2="12" y2="2"></line><line x1="12" y1="22" x2="12" y2="18"></line></svg>
            ${isFocusActive ? 'Change Focus' : 'Set Focused Decks'}
          </button>
          ${isFocusActive ? `
            <button class="btn btn-ghost btn-sm" id="btn-clear-focus">
              Clear Focus
            </button>
          ` : ''}
        </div>
      </section>

      <!-- 3. Your Classes & Subjects (Swapped above graph) -->
      <section class="dashboard-section">
        <div class="section-header">
          <div>
            <h2 class="section-title">Your Classes & Subjects</h2>
            <p class="section-subtitle">Click "🎯 Focus" to set any class in focus for your daily review.</p>
          </div>
          <button class="btn btn-outline btn-sm" id="btn-view-all-decks">
            View Folders &amp; Decks &rarr;
          </button>
        </div>

        <div class="classes-grid">
          ${rootGroups.map(group => {
            const childGroups = groups.filter(g => g.parentId === group.id);
            const childGroupIds = new Set(childGroups.map(g => g.id));
            const classCards = cards.filter(c => c.groupId === group.id || childGroupIds.has(c.groupId));
            const classReviewItems = classCards.flatMap(c => getReviewItemsForCard(c));
            const classDailyQueue = getDailyReviewQueue(classReviewItems, settings, reviewLogs, todayStr);
            const totalInClass = classCards.reduce((sum, c) => sum + getCardCount(c), 0);
            const dueInClass = classDailyQueue.totalDailyCount;
            const isThisClassFocused = focusedGroupIds.includes(group.id);

            const iconEmoji = group.icon === 'globe' ? '🌍' : group.icon === 'dna' ? '🧬' : group.icon === 'atom' ? '⚛️' : group.icon === 'palette' ? '🎨' : group.icon === 'compass' ? '🧭' : group.icon === 'microscope' ? '🔬' : '📚';
            return `
              <div class="class-card ${isThisClassFocused ? 'is-focused' : ''}" style="border-top-color: ${group.color || '#c05638'};">
                <div class="class-card-header">
                  <div class="class-name-wrap">
                    <span class="group-icon-badge" style="background: ${group.color}20; color: ${group.color};">
                      ${iconEmoji}
                    </span>
                    <h3 class="class-name">${escapeHtml(group.name)}</h3>
                  </div>
                  <span class="badge ${dueInClass > 0 ? 'badge-due' : 'badge-neutral'}">
                    ${dueInClass > 0 ? `${dueInClass} Due` : 'Caught up'}
                  </span>
                </div>

                <div class="class-card-meta">
                  <span>${totalInClass} cards</span>
                  <span>•</span>
                  <span>${childGroups.length} units</span>
                  ${isThisClassFocused ? `<span>• <strong style="color: var(--primary);">In Focus</strong></span>` : ''}
                </div>

                <div class="class-card-actions">
                  <button class="btn btn-primary btn-sm btn-class-daily" data-group-id="${group.id}">
                    Daily (${dueInClass})
                  </button>
                  <button class="btn btn-outline btn-sm btn-class-endless" data-group-id="${group.id}" title="Endless Practice">
                    Endless
                  </button>
                  <button class="btn ${isThisClassFocused ? 'btn-focused' : 'btn-outline'} btn-sm btn-class-focus-toggle" data-group-id="${group.id}">
                    ${isThisClassFocused ? '✓ Focused' : '🎯 Focus'}
                  </button>
                  <button class="btn btn-ghost btn-sm btn-class-open" data-group-id="${group.id}" title="Open Folder">
                    View &rarr;
                  </button>
                </div>
              </div>
            `;
          }).join('')}

          <div class="class-card class-card-add" id="btn-add-new-class">
            <div class="add-class-inner">
              <div class="add-icon">+</div>
              <div class="add-text">Add New Class / Subject</div>
            </div>
          </div>
        </div>
      </section>

      <!-- 4. Stat Badges Row -->
      <section class="stats-overview-grid">
        <div class="stat-card">
          <div class="stat-icon stat-icon-blue">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="7" width="20" height="14" rx="2" ry="2"></rect><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"></path></svg>
          </div>
          <div class="stat-info">
            <div class="stat-number">${totalCards}</div>
            <div class="stat-title">${isFocusActive ? 'Cards in Focus' : 'Cards in Focus (None)'}</div>
          </div>
        </div>

        <div class="stat-card">
          <div class="stat-icon stat-icon-orange">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
          </div>
          <div class="stat-info">
            <div class="stat-number">${totalDueCards}</div>
            <div class="stat-title">${isFocusActive ? 'Due for Review' : 'Due for Review (Set focus)'}</div>
          </div>
        </div>

        <div class="stat-card">
          <div class="stat-icon stat-icon-green">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>
          </div>
          <div class="stat-info">
            <div class="stat-number">${reviewCards.length}</div>
            <div class="stat-title">Mastered / Learning</div>
          </div>
        </div>

        <div class="stat-card">
          <div class="stat-icon stat-icon-purple">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path></svg>
          </div>
          <div class="stat-info">
            <div class="stat-number">${rootGroups.length}</div>
            <div class="stat-title">Active Classes</div>
          </div>
        </div>
      </section>

      <!-- 5. 30-Day Study Calendar & Forecast (Pixel-perfect CSS Grid) -->
      <section class="forecast-calendar-section">
        <!-- Floating Tooltip Container (Positioned in section to prevent scroll clipping) -->
        <div id="forecast-floating-tooltip" class="forecast-floating-tooltip" style="display: none;"></div>

        <div class="forecast-header">
          <div class="forecast-title-wrap">
            <h2>30-Day Study Calendar & Forecast</h2>
            <p>Spaced repetition schedule across the last 5 days, today, and the next 25 days${isFocusActive ? ' (filtered to focused decks)' : ''}.</p>
          </div>
          <div class="forecast-legend">
            <div class="legend-item">
              <span class="legend-swatch swatch-new"></span>
              <span>New Cards</span>
            </div>
            <div class="legend-item">
              <span class="legend-swatch swatch-review"></span>
              <span>Reviews</span>
            </div>
          </div>
        </div>

        ${!isFocusActive ? `
          <div class="forecast-no-focus-banner">
            <div class="no-focus-banner-text">
              <span class="no-focus-icon">🎯</span>
              <div>
                <h4>No decks currently in focus</h4>
                <p>Put decks in focus to generate your daily review set and preview your 30-day spaced repetition schedule.</p>
              </div>
            </div>
            <button class="btn btn-primary btn-sm" id="btn-forecast-set-focus">Set Decks in Focus</button>
          </div>
        ` : ''}

        <!-- Summary Metrics Row -->
        <div class="forecast-metrics-row">
          <div class="forecast-metric-item">
            <span class="forecast-metric-val">${past5Completed}</span>
            <span class="forecast-metric-lbl">Past 5 Days Completed</span>
          </div>
          <div class="forecast-metric-item">
            <span class="forecast-metric-val" style="color: ${isFocusActive ? 'var(--primary)' : 'var(--text-muted)'};">
              ${isFocusActive ? totalDueCards : '0'}
            </span>
            <span class="forecast-metric-lbl">${isFocusActive ? 'Ready for Review Today' : 'Ready Today (Set Focus)'}</span>
          </div>
          <div class="forecast-metric-item">
            <span class="forecast-metric-val">${future25Projected}</span>
            <span class="forecast-metric-lbl">Next 25 Days Projected</span>
          </div>
          <div class="forecast-metric-item">
            <span class="forecast-metric-val">${dailyAverage}</span>
            <span class="forecast-metric-lbl">Daily Average</span>
          </div>
        </div>

        <!-- Stacked Bar Chart with Pixel-Perfect 31-Column CSS Grid -->
        <div class="chart-scroll-wrapper">
          <div class="forecast-chart-container">
            <!-- Zones Header: exactly aligned to columns via CSS Grid -->
            <div class="chart-zones-header">
              <div class="zone-past">Last 5 Days</div>
              <div class="zone-today">
                <span class="zone-today-badge">Today</span>
              </div>
              <div class="zone-future">Next 25 Days</div>
            </div>

            <!-- Chart Bars Track: 31 columns grid -->
            <div class="chart-bars-track">
              <!-- Reference Grid Lines -->
              <div class="chart-grid-line" style="bottom: 33%;"></div>
              <div class="chart-grid-line" style="bottom: 66%;"></div>
              
              ${daysData.map(d => {
                const totalH = d.totalCount > 0 
                  ? Math.max(16, Math.round((d.totalCount / dynamicScaleMax) * availableBarHeightPx)) 
                  : 4;
                const reviewH = d.totalCount > 0 
                  ? Math.round((d.reviewCount / d.totalCount) * totalH) 
                  : 0;
                const newH = d.totalCount > 0 
                  ? (totalH - reviewH) 
                  : 0;

                const colClass = d.isToday ? 'chart-day-col col-today' : (d.isPast ? 'chart-day-col col-past' : 'chart-day-col');

                return `
                  <div class="${colClass}"
                    data-day-name="${escapeHtml(d.dayName)}"
                    data-month="${escapeHtml(d.monthName)}"
                    data-day-num="${d.dayNum}"
                    data-status="${escapeHtml(d.statusLabel)}"
                    data-new="${d.newCount}"
                    data-review="${d.reviewCount}"
                    data-total="${d.totalCount}"
                    data-is-today="${d.isToday ? 'true' : 'false'}"
                    tabindex="0"
                    aria-label="${escapeHtml(d.dayName)}, ${escapeHtml(d.monthName)} ${d.dayNum}: ${d.newCount} new, ${d.reviewCount} reviews, ${d.totalCount} total"
                  >
                    ${d.totalCount > 0 ? `<span class="bar-count-badge">${d.totalCount}</span>` : ''}

                    <div class="stacked-bar-wrapper" style="height: ${totalH}px;">
                      <div class="bar-segment bar-segment-review" style="height: ${reviewH}px;"></div>
                      <div class="bar-segment bar-segment-new" style="height: ${newH}px;"></div>
                    </div>
                  </div>
                `;
              }).join('')}
            </div>

            <!-- Axis Labels Row: 31 columns grid -->
            <div class="chart-axis-labels">
              ${daysData.map(d => `
                <div class="axis-day-label ${d.isToday ? 'label-today' : ''}" title="${d.monthName} ${d.dayNum} (${d.statusLabel})">
                  ${d.dayNum}
                </div>
              `).join('')}
            </div>
          </div>
        </div>
      </section>
    </div>
  `;

  // -------------------------------------------------------------
  // Dynamic Floating Tooltip for Forecast Chart
  // Guarantees zero clipping and crystal clear breakdown of new vs review cards
  // -------------------------------------------------------------
  const forecastSection = container.querySelector('.forecast-calendar-section');
  const floatingTooltip = container.querySelector('#forecast-floating-tooltip');
  const dayCols = container.querySelectorAll('.chart-day-col');

  if (forecastSection && floatingTooltip && dayCols.length > 0) {
    dayCols.forEach(col => {
      const showTooltip = () => {
        const dayName = col.dataset.dayName || '';
        const month = col.dataset.month || '';
        const dayNum = col.dataset.dayNum || '';
        const status = col.dataset.status || '';
        const newCount = col.dataset.new || '0';
        const reviewCount = col.dataset.review || '0';
        const totalCount = col.dataset.total || '0';
        const isToday = col.dataset.isToday === 'true';

        col.classList.add('is-hovered');

        floatingTooltip.innerHTML = `
          <div class="chart-tooltip-header">
            <span class="tooltip-date-title">${dayName}, ${month} ${dayNum}</span>
            <span class="tooltip-badge ${isToday ? 'tooltip-badge-today' : ''}">${status}</span>
          </div>
          <div class="chart-tooltip-body">
            <div class="chart-tooltip-row row-new">
              <span class="tooltip-label">
                <span class="tooltip-dot swatch-new"></span>
                New Cards:
              </span>
              <strong class="tooltip-val">${newCount}</strong>
            </div>
            <div class="chart-tooltip-row row-review">
              <span class="tooltip-label">
                <span class="tooltip-dot swatch-review"></span>
                Reviews:
              </span>
              <strong class="tooltip-val">${reviewCount}</strong>
            </div>
            <div class="chart-tooltip-divider"></div>
            <div class="chart-tooltip-row row-total">
              <span class="tooltip-label">Total Cards:</span>
              <strong class="tooltip-val-total">${totalCount}</strong>
            </div>
          </div>
        `;

        floatingTooltip.style.display = 'block';

        const colRect = col.getBoundingClientRect();
        const sectionRect = forecastSection.getBoundingClientRect();

        const tooltipW = floatingTooltip.offsetWidth || 180;
        const tooltipH = floatingTooltip.offsetHeight || 100;

        let left = (colRect.left - sectionRect.left) + (colRect.width / 2);
        // Position above the column
        let top = (colRect.top - sectionRect.top) - tooltipH - 12;

        // If top would be above the section or clipped, place below the column top
        if (top < 10) {
          top = (colRect.top - sectionRect.top) + 24;
        }

        // Clamp horizontally so it stays cleanly inside forecastSection
        const minLeft = (tooltipW / 2) + 12;
        const maxLeft = sectionRect.width - (tooltipW / 2) - 12;
        left = Math.max(minLeft, Math.min(maxLeft, left));

        floatingTooltip.style.left = `${left}px`;
        floatingTooltip.style.top = `${top}px`;
      };

      const hideTooltip = () => {
        col.classList.remove('is-hovered');
        floatingTooltip.style.display = 'none';
      };

      col.addEventListener('mouseenter', showTooltip);
      col.addEventListener('mouseleave', hideTooltip);
      col.addEventListener('focus', showTooltip);
      col.addEventListener('blur', hideTooltip);
    });
  }

  // -------------------------------------------------------------
  // Live Streak Countdown Timer (Device Clock)
  // -------------------------------------------------------------
  function updateStreakTimer() {
    const countdownEl = container.querySelector('#streak-reset-countdown');
    if (!countdownEl) return;
    const currentNow = new Date();
    const midnight = new Date(currentNow.getFullYear(), currentNow.getMonth(), currentNow.getDate() + 1, 0, 0, 0, 0);
    const diffMs = midnight - currentNow;
    if (diffMs <= 0) {
      countdownEl.textContent = '0h 00m 00s';
      return;
    }
    const hours = Math.floor(diffMs / (1000 * 60 * 60));
    const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((diffMs % (1000 * 60)) / 1000);
    countdownEl.textContent = `${hours}h ${String(minutes).padStart(2, '0')}m ${String(seconds).padStart(2, '0')}s`;
  }

  updateStreakTimer();
  window.__streakTimerInterval = setInterval(updateStreakTimer, 1000);

  // -------------------------------------------------------------
  // Clean Modal Popup Appended Directly to document.body
  // Ensures 100% full-screen shading, no parent transform issues, and centered positioning.
  // -------------------------------------------------------------
  const modalEl = document.createElement('div');
  modalEl.id = 'focus-hierarchy-modal';
  modalEl.className = 'modal-backdrop hidden';
  modalEl.innerHTML = `
    <div class="modal-window animate-scale-up focus-modal-window">
      <div class="modal-header focus-modal-header">
        <div style="display: flex; align-items: center; gap: 0.75rem;">
          <span style="font-size: 1.5rem; line-height: 1;">🎯</span>
          <div>
            <h3 style="font-family: var(--font-display); font-size: 1.15rem; font-weight: 700; margin: 0; color: var(--text-main);">Set Decks in Focus</h3>
            <p style="font-size: 0.8rem; color: var(--text-muted); margin: 0.2rem 0 0 0;">Choose which Classes, Units, or Lessons to include in daily review.</p>
          </div>
        </div>
        <button class="btn-close" id="btn-close-focus-modal" title="Close dialog">&times;</button>
      </div>

      <div class="modal-body focus-modal-body">
        <div class="focus-modal-toolbar">
          <span class="focus-selection-count" id="focus-selection-count">0 decks selected</span>
          <div class="focus-toolbar-actions">
            <button type="button" class="btn btn-ghost btn-xs" id="btn-modal-select-all">Select All</button>
            <button type="button" class="btn btn-ghost btn-xs" id="btn-modal-clear-all">Clear All</button>
          </div>
        </div>

        <div class="focus-tree-container" id="focus-tree-list">
          <!-- Populated dynamically -->
        </div>
      </div>

      <div class="modal-footer focus-modal-footer">
        <button type="button" class="btn btn-secondary" id="btn-modal-cancel">Cancel</button>
        <button type="button" class="btn btn-primary" id="btn-modal-apply">Apply Focus</button>
      </div>
    </div>
  `;
  document.body.appendChild(modalEl);

  const focusTreeList = modalEl.querySelector('#focus-tree-list');
  const focusSelectionCount = modalEl.querySelector('#focus-selection-count');

  function updateModalSelectionCount() {
    if (!focusSelectionCount || !focusTreeList) return;
    const checkedBoxes = focusTreeList.querySelectorAll('.focus-tree-item-checkbox:checked');
    const count = checkedBoxes.length;
    focusSelectionCount.textContent = `${count} ${count === 1 ? 'deck' : 'decks'} selected`;
  }

  function renderHierarchyTree(checkedIdsSet) {
    if (!focusTreeList) return;
    const roots = groups.filter(g => !g.parentId);
    const items = [];

    for (const root of roots) {
      const units = groups.filter(g => g.parentId === root.id);
      const allSubIds = getSubgroupIdsSync(root.id);
      const totalClassCards = cards.filter(c => c.groupId === root.id || allSubIds.has(c.groupId)).length;

      items.push({
        id: root.id,
        name: root.name,
        icon: '📚',
        level: 'class',
        levelLabel: 'Class',
        cardCount: totalClassCards,
        parentId: null
      });

      for (const unit of units) {
        const lessons = groups.filter(g => g.parentId === unit.id);
        const unitSubs = getSubgroupIdsSync(unit.id);
        const totalUnitCards = cards.filter(c => c.groupId === unit.id || unitSubs.has(c.groupId)).length;

        items.push({
          id: unit.id,
          name: unit.name,
          icon: '🔬',
          level: 'unit',
          levelLabel: 'Unit',
          cardCount: totalUnitCards,
          parentId: root.id
        });

        for (const lesson of lessons) {
          const lessonCards = cards.filter(c => c.groupId === lesson.id).length;
          items.push({
            id: lesson.id,
            name: lesson.name,
            icon: '📄',
            level: 'lesson',
            levelLabel: 'Lesson',
            cardCount: lessonCards,
            parentId: unit.id
          });
        }
      }
    }

    // Unassigned or custom decks
    const knownIds = new Set(items.map(i => i.id));
    const orphans = groups.filter(g => !knownIds.has(g.id));
    for (const orph of orphans) {
      items.push({
        id: orph.id,
        name: orph.name,
        icon: '📁',
        level: 'lesson',
        levelLabel: 'Deck',
        cardCount: cards.filter(c => c.groupId === orph.id).length,
        parentId: null
      });
    }

    focusTreeList.innerHTML = items.map(item => {
      const isChecked = checkedIdsSet.has(item.id);
      return `
        <div class="focus-tree-item level-${item.level} ${isChecked ? 'is-checked' : ''}" data-group-id="${item.id}">
          <div class="focus-tree-item-left">
            <input type="checkbox" class="focus-tree-item-checkbox" value="${item.id}" ${isChecked ? 'checked' : ''} />
            <span style="font-size: 1.1rem; line-height: 1;">${item.icon}</span>
            <span class="focus-item-name">${escapeHtml(item.name)}</span>
            <span class="focus-level-badge badge-${item.level}-lvl">${item.levelLabel}</span>
          </div>
          <span class="focus-tree-item-count">${item.cardCount} cards</span>
        </div>
      `;
    }).join('');

    updateModalSelectionCount();

    // Toggle row on item click
    focusTreeList.querySelectorAll('.focus-tree-item').forEach(row => {
      row.addEventListener('click', (e) => {
        const cb = row.querySelector('.focus-tree-item-checkbox');
        if (!cb) return;
        if (e.target !== cb) {
          cb.checked = !cb.checked;
        }
        row.classList.toggle('is-checked', cb.checked);
        updateModalSelectionCount();
      });
    });
  }

  function openFocusModal() {
    const checkedSet = new Set(focusedGroupIds);
    renderHierarchyTree(checkedSet);
    modalEl.classList.remove('hidden');
  }

  function closeFocusModal() {
    modalEl.classList.add('hidden');
  }

  // Wire modal close buttons
  modalEl.querySelector('#btn-close-focus-modal')?.addEventListener('click', closeFocusModal);
  modalEl.querySelector('#btn-modal-cancel')?.addEventListener('click', closeFocusModal);
  modalEl.addEventListener('click', (e) => {
    if (e.target === modalEl) closeFocusModal();
  });

  // Modal Select All / Clear All
  modalEl.querySelector('#btn-modal-clear-all')?.addEventListener('click', () => {
    focusTreeList.querySelectorAll('.focus-tree-item-checkbox').forEach(cb => {
      cb.checked = false;
      cb.closest('.focus-tree-item')?.classList.remove('is-checked');
    });
    updateModalSelectionCount();
  });

  modalEl.querySelector('#btn-modal-select-all')?.addEventListener('click', () => {
    focusTreeList.querySelectorAll('.focus-tree-item-checkbox').forEach(cb => {
      cb.checked = true;
      cb.closest('.focus-tree-item')?.classList.add('is-checked');
    });
    updateModalSelectionCount();
  });

  // Modal Apply Focus
  modalEl.querySelector('#btn-modal-apply')?.addEventListener('click', async () => {
    const checkedBoxes = focusTreeList.querySelectorAll('.focus-tree-item-checkbox:checked');
    const selectedIds = Array.from(checkedBoxes).map(cb => cb.value);
    settings.focusedGroupIds = selectedIds;
    await storage.saveSettings(settings);
    closeFocusModal();
    renderDashboard(container, navigateTo);
  });

  // Open modal button triggers
  container.querySelector('#btn-open-focus-modal')?.addEventListener('click', openFocusModal);
  container.querySelector('#btn-hero-select-focus')?.addEventListener('click', openFocusModal);
  container.querySelector('#btn-forecast-set-focus')?.addEventListener('click', openFocusModal);

  // -------------------------------------------------------------
  // Dashboard Action Handlers
  // -------------------------------------------------------------
  const btnStartDaily = container.querySelector('#btn-start-daily');
  if (btnStartDaily) {
    btnStartDaily.addEventListener('click', () => {
      navigateTo('study', { mode: 'daily', focusedGroupIds });
    });
  }

  const btnStartEndlessAll = container.querySelector('#btn-start-endless-all');
  if (btnStartEndlessAll) {
    btnStartEndlessAll.addEventListener('click', () => {
      navigateTo('study', { mode: 'endless', focusedGroupIds: isFocusActive ? focusedGroupIds : null });
    });
  }

  const btnNewCardQuick = container.querySelector('#btn-new-card-quick');
  if (btnNewCardQuick) {
    btnNewCardQuick.addEventListener('click', () => {
      window.dispatchEvent(new CustomEvent('open-card-editor', { detail: {} }));
    });
  }

  const btnViewAllDecks = container.querySelector('#btn-view-all-decks');
  if (btnViewAllDecks) {
    btnViewAllDecks.addEventListener('click', () => {
      navigateTo('decks');
    });
  }

  const btnAddNewClass = container.querySelector('#btn-add-new-class');
  if (btnAddNewClass) {
    btnAddNewClass.addEventListener('click', () => {
      window.dispatchEvent(new CustomEvent('open-group-modal', { detail: { parentId: null } }));
    });
  }

  // Remove focus tag chip click
  container.querySelectorAll('.focus-tag-remove').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const removeId = btn.dataset.removeId;
      const updated = focusedGroupIds.filter(id => id !== removeId);
      settings.focusedGroupIds = updated;
      await storage.saveSettings(settings);
      renderDashboard(container, navigateTo);
    });
  });

  // Clear focus button
  const btnClearFocus = container.querySelector('#btn-clear-focus');
  if (btnClearFocus) {
    btnClearFocus.addEventListener('click', async () => {
      settings.focusedGroupIds = [];
      await storage.saveSettings(settings);
      renderDashboard(container, navigateTo);
    });
  }

  // Quick Class card focus toggle
  container.querySelectorAll('.btn-class-focus-toggle').forEach(btn => {
    btn.addEventListener('click', async () => {
      const gId = btn.dataset.groupId;
      let updated;
      if (focusedGroupIds.includes(gId)) {
        updated = focusedGroupIds.filter(id => id !== gId);
      } else {
        updated = [...focusedGroupIds, gId];
      }
      settings.focusedGroupIds = updated;
      await storage.saveSettings(settings);
      renderDashboard(container, navigateTo);
    });
  });

  // Class card actions
  container.querySelectorAll('.btn-class-daily').forEach(btn => {
    btn.addEventListener('click', () => {
      navigateTo('study', { mode: 'daily', groupId: btn.dataset.groupId, includeSubgroups: true });
    });
  });

  container.querySelectorAll('.btn-class-endless').forEach(btn => {
    btn.addEventListener('click', () => {
      navigateTo('study', { mode: 'endless', groupId: btn.dataset.groupId, includeSubgroups: true });
    });
  });

  container.querySelectorAll('.btn-class-open').forEach(btn => {
    btn.addEventListener('click', () => {
      navigateTo('decks', { focusGroupId: btn.dataset.groupId });
    });
  });
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
