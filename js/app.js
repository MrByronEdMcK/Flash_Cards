/**
 * Application Entry & Router
 * Ties together Dashboard, Hierarchy Tree, Card Editor, Study View, and Modals.
 */

import { storage } from './storage.js';
import { renderDashboard } from './ui/dashboardView.js';
import { TreeView } from './ui/treeView.js';
import { CardEditorModal } from './ui/cardEditor.js';
import { StudyView } from './ui/studyView.js';
import { ModalManager } from './ui/modal.js';

class FlashcardApp {
  constructor() {
    this.currentView = 'dashboard';
    this.viewOptions = {};
    this.mainContainer = document.getElementById('app-main');
    this.treeView = null;
    this.studyView = null;
    this.cardEditor = null;
    this.modals = null;
  }

  async init() {
    await storage.init();

    // Initialize UI components & Modals
    this.cardEditor = new CardEditorModal();
    this.modals = new ModalManager();
    this.treeView = new TreeView(this.mainContainer, (view, opts) => this.navigate(view, opts));
    this.studyView = new StudyView(this.mainContainer, (view, opts) => this.navigate(view, opts));

    // Load initial theme and accent
    const settings = await storage.getSettings();
    const initialTheme = (settings && settings.theme) ? settings.theme : 'light';
    const initialAccent = (settings && settings.accent) ? settings.accent : 'orange';
    document.documentElement.setAttribute('data-theme', initialTheme);
    document.documentElement.setAttribute('data-accent', initialAccent);

    this._setupNavbar();
    this._updateThemeIcon(initialTheme);
    this._setupGlobalEvents();
    this._setupPwaInstall();
    this._setupServiceWorker();

    // Default route
    await this.navigate('dashboard');
  }

  async navigate(view, options = {}) {
    this.currentView = view;
    this.viewOptions = options;

    // Update active nav button
    document.querySelectorAll('.nav-link').forEach(link => {
      link.classList.toggle('active', link.dataset.view === view);
    });

    if (view === 'dashboard') {
      if (this.studyView) this.studyView.destroy();
      await renderDashboard(this.mainContainer, (v, o) => this.navigate(v, o));
    } else if (view === 'decks') {
      if (this.studyView) this.studyView.destroy();
      await this.treeView.render(options);
    } else if (view === 'study') {
      await this.studyView.start(options);
    }
  }

  _setupNavbar() {
    document.querySelectorAll('.nav-link').forEach(link => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        const view = link.dataset.view;
        this.navigate(view);
      });
    });

    // Nav actions
    const btnNewCard = document.getElementById('nav-btn-new-card');
    if (btnNewCard) {
      btnNewCard.addEventListener('click', () => {
        this.cardEditor.open({});
      });
    }

    const btnShare = document.getElementById('nav-btn-share');
    if (btnShare) {
      btnShare.addEventListener('click', () => {
        this.modals.openImportExportModal({});
      });
    }

    const btnSettings = document.getElementById('nav-btn-settings');
    if (btnSettings) {
      btnSettings.addEventListener('click', () => {
        this.modals.openSettingsModal();
      });
    }

    const themeToggle = document.getElementById('nav-theme-toggle');
    if (themeToggle) {
      themeToggle.addEventListener('click', async () => {
        const currentTheme = document.documentElement.getAttribute('data-theme') || 'light';
        const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', newTheme);
        this._updateThemeIcon(newTheme);
        const settings = await storage.getSettings();
        settings.theme = newTheme;
        await storage.saveSettings(settings);
      });
    }
  }

  _updateThemeIcon(theme) {
    const themeToggle = document.getElementById('nav-theme-toggle');
    if (!themeToggle) return;
    if (theme === 'dark') {
      themeToggle.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>`;
      themeToggle.title = 'Switch to Warm Beige (Light)';
    } else {
      themeToggle.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line></svg>`;
      themeToggle.title = 'Switch to Dark Roast (Night)';
    }
  }

  _setupGlobalEvents() {
    // Custom events from components
    window.addEventListener('open-card-editor', (e) => {
      this.cardEditor.open(e.detail || {});
    });

    window.addEventListener('open-group-modal', (e) => {
      this.modals.openGroupModal(e.detail || {});
    });

    window.addEventListener('edit-group-modal', (e) => {
      this.modals.openGroupModal({ groupId: e.detail.groupId });
    });

    window.addEventListener('export-group-request', (e) => {
      this.modals.openImportExportModal({ defaultGroupId: e.detail.groupId });
    });

    window.addEventListener('delete-group-request', async (e) => {
      const g = await storage.getGroup(e.detail.groupId);
      const name = g ? g.name : 'this folder';
      if (confirm(`Are you sure you want to delete "${name}" and all of its sub-folders and cards?`)) {
        await storage.deleteGroup(e.detail.groupId, true);
        if (this.currentView === 'decks') {
          this.treeView.selectedGroupId = null;
          await this.treeView.render();
        } else {
          await this.navigate('decks');
        }
      }
    });

    window.addEventListener('card-saved', () => {
      if (this.currentView === 'decks') {
        this.treeView.render();
      } else if (this.currentView === 'dashboard') {
        this.navigate('dashboard');
      }
    });

    window.addEventListener('groups-updated', () => {
      if (this.currentView === 'decks') {
        this.treeView.render();
      } else {
        this.navigate(this.currentView, this.viewOptions);
      }
    });

    window.addEventListener('navigate-to', (e) => {
      if (e.detail && e.detail.view) {
        this.navigate(e.detail.view, e.detail.options || {});
      }
    });

    window.addEventListener('settings-updated', async () => {
      const settings = await storage.getSettings();
      if (settings && settings.theme) {
        this._updateThemeIcon(settings.theme);
      }
      if (this.currentView === 'dashboard') {
        this.navigate('dashboard');
      }
    });
  }

  _setupServiceWorker() {
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js').then((registration) => {
          console.log('[SW] ServiceWorker registered with scope:', registration.scope);

          registration.addEventListener('updatefound', () => {
            const newWorker = registration.installing;
            if (!newWorker) return;
            newWorker.addEventListener('statechange', () => {
              if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                this._showUpdateNotification();
              }
            });
          });
        }).catch((err) => {
          console.warn('[SW] Registration failed:', err);
        });
      });
    }
  }

  _showUpdateNotification() {
    if (document.getElementById('pwa-update-toast')) return;
    const toast = document.createElement('div');
    toast.id = 'pwa-update-toast';
    toast.className = 'pwa-update-toast animate-scale-up';
    toast.innerHTML = `
      <span>🎉 A new version of StudyCards is ready!</span>
      <button class="btn btn-primary btn-xs" id="btn-reload-pwa">Update Now</button>
    `;
    document.body.appendChild(toast);
    toast.querySelector('#btn-reload-pwa')?.addEventListener('click', () => {
      window.location.reload();
    });
  }

  _setupPwaInstall() {
    const installBtn = document.getElementById('nav-btn-install');
    let deferredPrompt = null;

    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      deferredPrompt = e;
      if (installBtn) installBtn.classList.remove('hidden');
    });

    if (installBtn) {
      installBtn.addEventListener('click', async () => {
        if (!deferredPrompt) return;
        deferredPrompt.prompt();
        const { outcome } = await deferredPrompt.userChoice;
        console.log(`[PWA] Install prompt outcome: ${outcome}`);
        deferredPrompt = null;
        installBtn.classList.add('hidden');
      });
    }

    window.addEventListener('appinstalled', () => {
      console.log('[PWA] StudyCards was installed successfully');
      if (installBtn) installBtn.classList.add('hidden');
    });
  }
}

// Bootstrap on DOMContentLoaded
document.addEventListener('DOMContentLoaded', () => {
  const app = new FlashcardApp();
  window.app = app;
  app.init();
});
