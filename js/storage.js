/**
 * Storage Service
 * High-capacity IndexedDB storage with fallback to localStorage.
 * Handles cards, hierarchical groups, settings, review history, and JSON Import/Export.
 */

import { getSampleData, createDefaultSettings, getGeneralKnowledgeData } from './models.js';

const DB_NAME = 'FlashCardsDB';
const DB_VERSION = 1;

class StorageService {
  constructor() {
    this.db = null;
    this.isIndexedDBAvailable = typeof indexedDB !== 'undefined';
  }

  async init() {
    if (!this.isIndexedDBAvailable) {
      console.warn('IndexedDB not available, falling back to localStorage');
      this._initLocalStorage();
      return;
    }

    try {
      this.db = await this._openDB();
      // Purge any legacy demo review logs from previous sessions
      await this._purgeDemoReviewLogs();
      // Purge legacy Biology and Spanish demo decks
      await this._purgeLegacyDemoDecks();

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
      }

      // Request persistent storage protection against browser eviction
      await this.requestPersistence();
    } catch (err) {
      console.error('Failed to initialize IndexedDB, falling back to localStorage:', err);
      this.isIndexedDBAvailable = false;
      this._initLocalStorage();
    }
  }

  async requestPersistence() {
    if (typeof navigator !== 'undefined' && navigator.storage && navigator.storage.persist) {
      try {
        const isPersisted = await navigator.storage.persist();
        console.log(`[Storage] Persistent storage active: ${isPersisted}`);
        return isPersisted;
      } catch (e) {
        console.warn('[Storage] Persistence request warning:', e);
      }
    }
    return false;
  }

  async getStorageEstimate() {
    if (typeof navigator !== 'undefined' && navigator.storage && navigator.storage.estimate) {
      try {
        const estimate = await navigator.storage.estimate();
        const usageMB = Math.round((estimate.usage || 0) / (1024 * 1024) * 10) / 10;
        const quotaMB = Math.round((estimate.quota || 0) / (1024 * 1024));
        return {
          usageBytes: estimate.usage || 0,
          quotaBytes: estimate.quota || 0,
          usageMB,
          quotaMB,
          percent: estimate.quota ? Math.round((estimate.usage / estimate.quota) * 100) : 0
        };
      } catch (e) {
        return null;
      }
    }
    return null;
  }

  _openDB() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains('cards')) {
          const cardStore = db.createObjectStore('cards', { keyPath: 'id' });
          cardStore.createIndex('groupId', 'groupId', { unique: false });
          cardStore.createIndex('type', 'type', { unique: false });
        }
        if (!db.objectStoreNames.contains('groups')) {
          const groupStore = db.createObjectStore('groups', { keyPath: 'id' });
          groupStore.createIndex('parentId', 'parentId', { unique: false });
        }
        if (!db.objectStoreNames.contains('settings')) {
          db.createObjectStore('settings', { keyPath: 'key' });
        }
        if (!db.objectStoreNames.contains('reviews')) {
          const reviewStore = db.createObjectStore('reviews', { keyPath: 'id', autoIncrement: true });
          reviewStore.createIndex('cardId', 'cardId', { unique: false });
          reviewStore.createIndex('date', 'date', { unique: false });
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async seedInitialData() {
    const { groups, cards } = getSampleData();
    for (const g of groups) {
      await this.saveGroup(g);
    }
    for (const c of cards) {
      await this.saveCard(c);
    }
    await this.saveSettings(createDefaultSettings());
  }

  // --- Cards API ---
  async getCards(groupId = null, includeSubgroups = false) {
    if (!this.isIndexedDBAvailable) {
      return this._lsGetCards(groupId, includeSubgroups);
    }
    const all = await this._getAllFromStore('cards');
    if (!groupId) return all;

    if (!includeSubgroups) {
      return all.filter(c => c.groupId === groupId);
    }

    const groupIds = await this.getSubgroupIds(groupId);
    groupIds.add(groupId);
    return all.filter(c => groupIds.has(c.groupId));
  }

  async getCard(id) {
    if (!this.isIndexedDBAvailable) return this._lsGetCard(id);
    return this._getByKey('cards', id);
  }

  async saveCard(card) {
    if (!this.isIndexedDBAvailable) return this._lsSaveCard(card);
    card.updatedAt = new Date().toISOString();
    return this._putInStore('cards', card);
  }

  async deleteCard(id) {
    if (!this.isIndexedDBAvailable) return this._lsDeleteCard(id);
    return this._deleteFromStore('cards', id);
  }

  // --- Groups API ---
  async getGroups() {
    if (!this.isIndexedDBAvailable) return this._lsGetGroups();
    return this._getAllFromStore('groups');
  }

  async getGroup(id) {
    if (!this.isIndexedDBAvailable) return this._lsGetGroup(id);
    return this._getByKey('groups', id);
  }

  async saveGroup(group) {
    if (!this.isIndexedDBAvailable) return this._lsSaveGroup(group);
    return this._putInStore('groups', group);
  }

  async deleteGroup(id, deleteCards = true) {
    const subgroupIds = await this.getSubgroupIds(id);
    const allTargetGroupIds = new Set([id, ...subgroupIds]);

    if (!this.isIndexedDBAvailable) {
      this._lsDeleteGroups(allTargetGroupIds, deleteCards);
      return;
    }

    // Delete groups
    for (const gId of allTargetGroupIds) {
      await this._deleteFromStore('groups', gId);
    }

    // Delete or unassign associated cards
    const allCards = await this.getCards();
    for (const card of allCards) {
      if (allTargetGroupIds.has(card.groupId)) {
        if (deleteCards) {
          await this.deleteCard(card.id);
        } else {
          card.groupId = null;
          await this.saveCard(card);
        }
      }
    }
  }

  async getSubgroupIds(groupId) {
    const groups = await this.getGroups();
    const result = new Set();
    const findChildren = (parentId) => {
      for (const g of groups) {
        if (g.parentId === parentId && !result.has(g.id)) {
          result.add(g.id);
          findChildren(g.id);
        }
      }
    };
    findChildren(groupId);
    return result;
  }

  /**
   * Reset review progress for cards in a group (and optional sub-groups)
   * Resets SRS data back to 'new' state so cards re-enter daily and endless review queues.
   */
  async resetReviewData(groupId = null, includeSubgroups = true) {
    const todayStr = new Date().toISOString().split('T')[0];
    const cards = await this.getCards(groupId, includeSubgroups);
    let resetCount = 0;

    for (const card of cards) {
      card.srs = {
        state: 'new',
        interval: 0,
        easeFactor: 2.5,
        reps: 0,
        lapses: 0,
        consecutiveGoods: 0,
        dueDate: todayStr,
        lastReviewed: null
      };
      card.boxSrs = {};
      card.clozeSrs = {};
      await this.saveCard(card);
      resetCount++;
    }

    return resetCount;
  }

  /**
   * Reset review progress for a single card
   */
  async resetCardReviewData(cardId) {
    const card = await this.getCard(cardId);
    if (!card) return null;
    const todayStr = new Date().toISOString().split('T')[0];
    card.srs = {
      state: 'new',
      interval: 0,
      easeFactor: 2.5,
      reps: 0,
      lapses: 0,
      consecutiveGoods: 0,
      dueDate: todayStr,
      lastReviewed: null
    };
    card.boxSrs = {};
    card.clozeSrs = {};
    await this.saveCard(card);
    return card;
  }

  // --- Settings API ---
  async getSettings() {
    if (!this.isIndexedDBAvailable) return this._lsGetSettings();
    const res = await this._getByKey('settings', 'user_settings');
    return res ? res.value : createDefaultSettings();
  }

  async saveSettings(settings) {
    if (!this.isIndexedDBAvailable) return this._lsSaveSettings(settings);
    return this._putInStore('settings', { key: 'user_settings', value: settings });
  }

  // --- Review Logging ---
  async logReview(cardId, rating, oldSrs, newSrs) {
    const log = {
      cardId,
      rating,
      date: new Date().toISOString().split('T')[0],
      timestamp: new Date().toISOString(),
      oldInterval: oldSrs ? oldSrs.interval : 0,
      newInterval: newSrs ? newSrs.interval : 0
    };

    if (this.isIndexedDBAvailable) {
      await this._putInStore('reviews', log);
    } else {
      const logs = JSON.parse(localStorage.getItem('fc_reviews') || '[]');
      logs.push(log);
      localStorage.setItem('fc_reviews', JSON.stringify(logs));
    }

    // Update settings daily count and streak
    const settings = await this.getSettings();
    const today = new Date().toISOString().split('T')[0];
    
    if (settings.lastActiveDate !== today) {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayStr = yesterday.toISOString().split('T')[0];
      
      if (settings.lastActiveDate === yesterdayStr) {
        settings.streak = (settings.streak || 0) + 1;
      } else {
        settings.streak = 1;
      }
      settings.lastActiveDate = today;
      settings.cardsReviewedToday = 1;
    } else {
      settings.cardsReviewedToday = (settings.cardsReviewedToday || 0) + 1;
    }
    await this.saveSettings(settings);
  }

  async getReviewLogs() {
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
  }

  async _purgeLegacyDemoDecks() {
    try {
      const legacyGroupIds = ['grp_bio', 'grp_bio_u1', 'grp_bio_u1_l1', 'grp_bio_u2', 'grp_spanish', 'grp_spanish_u1'];
      const legacyCardIds = ['card_demo_1', 'card_demo_2', 'card_demo_3', 'card_demo_4', 'card_demo_5', 'card_demo_6'];

      if (this.isIndexedDBAvailable && this.db) {
        for (const gId of legacyGroupIds) {
          await this._deleteFromStore('groups', gId);
        }
        for (const cId of legacyCardIds) {
          await this._deleteFromStore('cards', cId);
        }
        const settings = await this.getSettings();
        if (settings && Array.isArray(settings.focusedGroupIds)) {
          const updatedFocus = settings.focusedGroupIds.filter(id => !legacyGroupIds.includes(id));
          if (updatedFocus.length === 0) {
            updatedFocus.push('grp_gk');
          }
          if (updatedFocus.length !== settings.focusedGroupIds.length) {
            settings.focusedGroupIds = updatedFocus;
            await this.saveSettings(settings);
          }
        }
      }

      const lsGroups = localStorage.getItem('fc_groups');
      if (lsGroups) {
        const groups = JSON.parse(lsGroups || '[]');
        const filtered = groups.filter(g => !legacyGroupIds.includes(g.id));
        localStorage.setItem('fc_groups', JSON.stringify(filtered));
      }
      const lsCards = localStorage.getItem('fc_cards');
      if (lsCards) {
        const cards = JSON.parse(lsCards || '[]');
        const filtered = cards.filter(c => !legacyCardIds.includes(c.id));
        localStorage.setItem('fc_cards', JSON.stringify(filtered));
      }
      const lsSettings = localStorage.getItem('fc_settings');
      if (lsSettings) {
        const settings = JSON.parse(lsSettings || '{}');
        if (Array.isArray(settings.focusedGroupIds)) {
          settings.focusedGroupIds = settings.focusedGroupIds.filter(id => !legacyGroupIds.includes(id));
          if (settings.focusedGroupIds.length === 0) {
            settings.focusedGroupIds = ['grp_gk'];
          }
          localStorage.setItem('fc_settings', JSON.stringify(settings));
        }
      }
    } catch (e) {
      console.warn('Failed to purge legacy demo decks:', e);
    }
  }

  // --- Import / Export ---
  async exportData(targetGroupId = null) {
    const allGroups = await this.getGroups();
    const allCards = await this.getCards();
    const settings = await this.getSettings();

    let exportGroups = allGroups;
    let exportCards = allCards;

    if (targetGroupId) {
      const subgroupIds = await this.getSubgroupIds(targetGroupId);
      const targetIds = new Set([targetGroupId, ...subgroupIds]);
      exportGroups = allGroups.filter(g => targetIds.has(g.id));
      exportCards = allCards.filter(c => targetIds.has(c.groupId));
    }

    return {
      version: 1,
      exportedAt: new Date().toISOString(),
      targetGroupId,
      groups: exportGroups,
      cards: exportCards,
      settings: targetGroupId ? undefined : settings
    };
  }

  async importData(data, mode = 'merge') {
    if (!data || !Array.isArray(data.cards) || !Array.isArray(data.groups)) {
      throw new Error('Invalid backup file format.');
    }

    if (mode === 'replace') {
      await this.clearAll();
    }

    const existingGroups = await this.getGroups();
    const existingGroupMap = new Map(existingGroups.map(g => [g.id, g]));

    for (const g of data.groups) {
      if (mode === 'merge' && existingGroupMap.has(g.id)) {
        // Keep or overwrite existing
        await this.saveGroup({ ...existingGroupMap.get(g.id), ...g });
      } else {
        await this.saveGroup(g);
      }
    }

    const existingCards = await this.getCards();
    const existingCardMap = new Map(existingCards.map(c => [c.id, c]));

    for (const c of data.cards) {
      if (mode === 'merge' && existingCardMap.has(c.id)) {
        await this.saveCard({ ...existingCardMap.get(c.id), ...c });
      } else {
        await this.saveCard(c);
      }
    }

    if (data.settings && mode === 'replace') {
      await this.saveSettings(data.settings);
    }

    return {
      groupsCount: data.groups.length,
      cardsCount: data.cards.length
    };
  }

  async clearAll() {
    if (this.isIndexedDBAvailable) {
      await this._clearStore('cards');
      await this._clearStore('groups');
      await this._clearStore('reviews');
    } else {
      localStorage.removeItem('fc_cards');
      localStorage.removeItem('fc_groups');
      localStorage.removeItem('fc_reviews');
    }
  }

  // --- IndexedDB generic helpers ---
  _getAllFromStore(storeName) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  _getByKey(storeName, key) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const req = store.get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }

  _putInStore(storeName, item) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      const req = store.put(item);
      req.onsuccess = () => resolve(item);
      req.onerror = () => reject(req.error);
    });
  }

  _deleteFromStore(storeName, key) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      const req = store.delete(key);
      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error);
    });
  }

  _clearStore(storeName) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      const req = store.clear();
      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error);
    });
  }

  // --- LocalStorage fallbacks ---
  _initLocalStorage() {
    if (!localStorage.getItem('fc_cards')) {
      const { groups, cards } = getSampleData();
      localStorage.setItem('fc_groups', JSON.stringify(groups));
      localStorage.setItem('fc_cards', JSON.stringify(cards));
      localStorage.setItem('fc_settings', JSON.stringify(createDefaultSettings()));
    } else {
      const groups = JSON.parse(localStorage.getItem('fc_groups') || '[]');
      if (!groups.some(g => g.id === 'grp_gk')) {
        const { gkGroups, gkCards } = getGeneralKnowledgeData();
        const cards = JSON.parse(localStorage.getItem('fc_cards') || '[]');
        const settings = JSON.parse(localStorage.getItem('fc_settings') || '{}');
        localStorage.setItem('fc_groups', JSON.stringify([...gkGroups, ...groups]));
        localStorage.setItem('fc_cards', JSON.stringify([...gkCards, ...cards]));
        const focused = Array.isArray(settings.focusedGroupIds) ? [...settings.focusedGroupIds] : [];
        if (!focused.includes('grp_gk')) {
          focused.unshift('grp_gk');
          settings.focusedGroupIds = focused;
        }
        localStorage.setItem('fc_settings', JSON.stringify(settings));
      }
    }
  }

  _lsGetCards() {
    return JSON.parse(localStorage.getItem('fc_cards') || '[]');
  }

  _lsGetCard(id) {
    const cards = this._lsGetCards();
    return cards.find(c => c.id === id) || null;
  }

  _lsSaveCard(card) {
    const cards = this._lsGetCards();
    const idx = cards.findIndex(c => c.id === card.id);
    if (idx >= 0) {
      cards[idx] = card;
    } else {
      cards.push(card);
    }
    localStorage.setItem('fc_cards', JSON.stringify(cards));
    return card;
  }

  _lsDeleteCard(id) {
    const cards = this._lsGetCards().filter(c => c.id !== id);
    localStorage.setItem('fc_cards', JSON.stringify(cards));
    return true;
  }

  _lsGetGroups() {
    return JSON.parse(localStorage.getItem('fc_groups') || '[]');
  }

  _lsGetGroup(id) {
    return this._lsGetGroups().find(g => g.id === id) || null;
  }

  _lsSaveGroup(group) {
    const groups = this._lsGetGroups();
    const idx = groups.findIndex(g => g.id === group.id);
    if (idx >= 0) {
      groups[idx] = group;
    } else {
      groups.push(group);
    }
    localStorage.setItem('fc_groups', JSON.stringify(groups));
    return group;
  }

  _lsDeleteGroups(targetGroupIds, deleteCards) {
    const groups = this._lsGetGroups().filter(g => !targetGroupIds.has(g.id));
    localStorage.setItem('fc_groups', JSON.stringify(groups));
    if (deleteCards) {
      const cards = this._lsGetCards().filter(c => !targetGroupIds.has(c.groupId));
      localStorage.setItem('fc_cards', JSON.stringify(cards));
    }
  }

  _lsGetSettings() {
    return JSON.parse(localStorage.getItem('fc_settings') || 'null') || createDefaultSettings();
  }

  _lsSaveSettings(settings) {
    localStorage.setItem('fc_settings', JSON.stringify(settings));
    return settings;
  }
}

export const storage = new StorageService();
