# scratch/apply_remove_bio_spanish.py

# 1. Update js/models.js
with open('js/models.js', 'r', encoding='utf-8') as f:
    models_code = f.read()

split_token = "// Built-in sample SVG image for the animal cell diagram"
assert split_token in models_code, "Could not find split token in models.js"
keep_part = models_code.split(split_token)[0]

new_get_sample_data = """export function getSampleData() {
  const { gkGroups, gkCards } = getGeneralKnowledgeData();
  return {
    groups: gkGroups,
    cards: gkCards
  };
}
"""

models_code = keep_part + new_get_sample_data

with open('js/models.js', 'w', encoding='utf-8') as f:
    f.write(models_code)
print('Updated js/models.js successfully')

# 2. Update js/storage.js
with open('js/storage.js', 'r', encoding='utf-8') as f:
    storage_code = f.read()

# Add purge call in init()
old_init_call = """      // Purge any legacy demo review logs from previous sessions
      await this._purgeDemoReviewLogs();"""

new_init_call = """      // Purge any legacy demo review logs from previous sessions
      await this._purgeDemoReviewLogs();
      // Purge legacy Biology and Spanish demo decks
      await this._purgeLegacyDemoDecks();"""

assert old_init_call in storage_code, "Could not find purgeDemoReviewLogs in storage.js init"
storage_code = storage_code.replace(old_init_call, new_init_call)

# Add _purgeLegacyDemoDecks method after _purgeDemoReviewLogs
old_purge_logs = """      console.warn('Failed to purge demo review logs:', e);
    }
  }"""

new_purge_decks = """      console.warn('Failed to purge demo review logs:', e);
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
  }"""

assert old_purge_logs in storage_code, "Could not find end of _purgeDemoReviewLogs in storage.js"
storage_code = storage_code.replace(old_purge_logs, new_purge_decks)

with open('js/storage.js', 'w', encoding='utf-8') as f:
    f.write(storage_code)
print('Updated js/storage.js successfully')

# 3. Bump sw.js cache to studycards-v4
with open('sw.js', 'r', encoding='utf-8') as f:
    sw_code = f.read()

sw_code = sw_code.replace("const CACHE_NAME = 'studycards-v3';", "const CACHE_NAME = 'studycards-v4';")
with open('sw.js', 'w', encoding='utf-8') as f:
    f.write(sw_code)
print('Updated sw.js cache to studycards-v4 successfully')
