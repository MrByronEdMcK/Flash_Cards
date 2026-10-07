# scratch/fix_review_logs.py

with open('js/storage.js', 'r', encoding='utf-8') as f:
    code = f.read()

# 1. Update init() in storage.js
old_init_section = """      this.db = await this._openDB();
      // Check if DB is empty, if so seed sample data
      const cards = await this.getCards();
      if (cards.length === 0) {
        await this.seedInitialData();
      } else {
        // Upgrade check: Ensure General Knowledge deck is present
        const gkGroup = await this.getGroup('grp_gk');
        if (!gkGroup) {
          const { gkGroups, gkCards } = getGeneralKnowledgeData();
          for (const g of gkGroups) {
            await this.saveGroup(g);
          }
          for (const c of gkCards) {
            await this.saveCard(c);
          }
          // Set grp_gk in focus if not already focused or if focused list is empty
          const settings = await this.getSettings();
          const focused = Array.isArray(settings.focusedGroupIds) ? [...settings.focusedGroupIds] : [];
          if (!focused.includes('grp_gk')) {
            focused.unshift('grp_gk');
            settings.focusedGroupIds = focused;
            await this.saveSettings(settings);
          }
        } else {
          // Ensure any unreviewed General Knowledge cards start as clean unlearned cards
          const allLogs = await this.getReviewLogs();
          const loggedCardIds = new Set((allLogs || []).map(l => l.cardId));
          const todayStr = new Date().toISOString().split('T')[0];
          const unreviewedGk = cards.filter(c => c.id && c.id.startsWith('card_gk_') && !loggedCardIds.has(c.id));
          for (const c of unreviewedGk) {
            if (c.srs && (c.srs.state !== 'new' || c.srs.interval !== 0)) {
              c.srs = {
                state: 'new',
                interval: 0,
                easeFactor: 2.5,
                reps: 0,
                lapses: 0,
                dueDate: todayStr,
                lastReviewed: null
              };
              await this.saveCard(c);
            }
          }
        }
      }"""

new_init_section = """      this.db = await this._openDB();
      // Purge any legacy demo review logs from previous sessions
      await this._purgeDemoReviewLogs();

      // Check if DB is empty, if so seed sample data
      const cards = await this.getCards();
      if (cards.length === 0) {
        await this.seedInitialData();
      } else {
        // Upgrade check: Ensure General Knowledge deck is present
        const gkGroup = await this.getGroup('grp_gk');
        if (!gkGroup) {
          const { gkGroups, gkCards } = getGeneralKnowledgeData();
          for (const g of gkGroups) {
            await this.saveGroup(g);
          }
          for (const c of gkCards) {
            await this.saveCard(c);
          }
          // Set grp_gk in focus if not already focused or if focused list is empty
          const settings = await this.getSettings();
          const focused = Array.isArray(settings.focusedGroupIds) ? [...settings.focusedGroupIds] : [];
          if (!focused.includes('grp_gk')) {
            focused.unshift('grp_gk');
            settings.focusedGroupIds = focused;
            await this.saveSettings(settings);
          }
        }
      }

      // If user has no real reviews logged, ensure all cards start as clean unlearned cards
      const userLogs = await this.getReviewLogs();
      if (userLogs.length === 0) {
        const todayStr = new Date().toISOString().split('T')[0];
        const allCards = await this.getCards();
        for (const c of allCards) {
          if (c.srs && (c.srs.state !== 'new' || c.srs.interval !== 0 || c.srs.reps !== 0)) {
            c.srs = {
              state: 'new',
              interval: 0,
              easeFactor: 2.5,
              reps: 0,
              lapses: 0,
              dueDate: todayStr,
              lastReviewed: null
            };
            await this.saveCard(c);
          }
        }
      }"""

assert old_init_section in code, "Could not find old init section in storage.js"
code = code.replace(old_init_section, new_init_section)

# 2. Update getReviewLogs() and remove _createDemoReviewLogs()
old_review_logs = """  async getReviewLogs() {
    let logs = [];
    if (!this.isIndexedDBAvailable) {
      logs = JSON.parse(localStorage.getItem('fc_reviews') || '[]');
    } else {
      logs = await this._getAllFromStore('reviews');
    }

    if (logs.length === 0) {
      const demoLogs = this._createDemoReviewLogs();
      for (const log of demoLogs) {
        if (this.isIndexedDBAvailable) {
          await this._putInStore('reviews', log);
        }
      }
      if (!this.isIndexedDBAvailable) {
        localStorage.setItem('fc_reviews', JSON.stringify(demoLogs));
      }
      return demoLogs;
    }

    return logs;
  }

  _createDemoReviewLogs() {
    const now = new Date();
    const getDateBefore = (daysAgo) => {
      const d = new Date(now);
      d.setDate(d.getDate() - daysAgo);
      return d.toISOString().split('T')[0];
    };
    return [
      { cardId: 'card_gk_021', rating: 3, date: getDateBefore(4), timestamp: new Date(now - 4 * 86400000).toISOString(), oldInterval: 0, newInterval: 1 },
      { cardId: 'card_gk_022', rating: 4, date: getDateBefore(4), timestamp: new Date(now - 4 * 86400000).toISOString(), oldInterval: 0, newInterval: 1 },
      { cardId: 'card_gk_036', rating: 3, date: getDateBefore(3), timestamp: new Date(now - 3 * 86400000).toISOString(), oldInterval: 0, newInterval: 2 },
      { cardId: 'card_gk_037', rating: 3, date: getDateBefore(3), timestamp: new Date(now - 3 * 86400000).toISOString(), oldInterval: 0, newInterval: 2 },
      { cardId: 'card_gk_049', rating: 3, date: getDateBefore(2), timestamp: new Date(now - 2 * 86400000).toISOString(), oldInterval: 0, newInterval: 3 },
      { cardId: 'card_gk_050', rating: 4, date: getDateBefore(2), timestamp: new Date(now - 2 * 86400000).toISOString(), oldInterval: 0, newInterval: 3 },
      { cardId: 'card_gk_061', rating: 3, date: getDateBefore(1), timestamp: new Date(now - 1 * 86400000).toISOString(), oldInterval: 0, newInterval: 5 },
      { cardId: 'card_gk_062', rating: 3, date: getDateBefore(1), timestamp: new Date(now - 1 * 86400000).toISOString(), oldInterval: 0, newInterval: 5 },
      { cardId: 'card_demo_1', rating: 3, date: getDateBefore(4), timestamp: new Date(now - 4 * 86400000).toISOString(), oldInterval: 0, newInterval: 1 },
      { cardId: 'card_demo_2', rating: 3, date: getDateBefore(3), timestamp: new Date(now - 3 * 86400000).toISOString(), oldInterval: 0, newInterval: 1 },
      { cardId: 'card_demo_1', rating: 3, date: getDateBefore(3), timestamp: new Date(now - 3 * 86400000).toISOString(), oldInterval: 1, newInterval: 3 },
      { cardId: 'card_demo_3', rating: 4, date: getDateBefore(2), timestamp: new Date(now - 2 * 86400000).toISOString(), oldInterval: 0, newInterval: 4 },
      { cardId: 'card_demo_4', rating: 3, date: getDateBefore(1), timestamp: new Date(now - 1 * 86400000).toISOString(), oldInterval: 0, newInterval: 1 },
      { cardId: 'card_demo_2', rating: 3, date: getDateBefore(1), timestamp: new Date(now - 1 * 86400000).toISOString(), oldInterval: 1, newInterval: 3 }
    ];
  }"""

new_review_logs = """  async getReviewLogs() {
    if (!this.isIndexedDBAvailable) {
      return JSON.parse(localStorage.getItem('fc_reviews') || '[]');
    }
    return this._getAllFromStore('reviews');
  }

  async _purgeDemoReviewLogs() {
    try {
      if (this.isIndexedDBAvailable && this.db) {
        const allLogs = await this._getAllFromStore('reviews');
        for (const log of allLogs) {
          // Demo logs either have numeric auto-increment IDs or IDs that do not start with 'rev_'
          const isDemo = typeof log.id === 'number' || (typeof log.id === 'string' && !log.id.startsWith('rev_'));
          if (isDemo) {
            await this._deleteFromStore('reviews', log.id);
          }
        }
      }
      const lsRaw = localStorage.getItem('fc_reviews');
      if (lsRaw) {
        const lsLogs = JSON.parse(lsRaw || '[]');
        const filtered = lsLogs.filter(log => typeof log.id === 'string' && log.id.startsWith('rev_'));
        localStorage.setItem('fc_reviews', JSON.stringify(filtered));
      }
    } catch (e) {
      console.warn('Failed to purge demo review logs:', e);
    }
  }"""

assert old_review_logs in code, "Could not find old review logs section in storage.js"
code = code.replace(old_review_logs, new_review_logs)

with open('js/storage.js', 'w', encoding='utf-8') as f:
    f.write(code)
print('Updated js/storage.js successfully')

# 3. Bump sw.js cache to studycards-v3
with open('sw.js', 'r', encoding='utf-8') as f:
    sw = f.read()

sw = sw.replace("const CACHE_NAME = 'studycards-v2';", "const CACHE_NAME = 'studycards-v3';")
with open('sw.js', 'w', encoding='utf-8') as f:
    f.write(sw)
print('Updated sw.js cache to studycards-v3 successfully')
