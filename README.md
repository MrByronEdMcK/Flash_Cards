# 🎴 StudyCards — Smart Spaced Repetition Flashcards

A modern, student-focused flashcard web application designed for Secondary school students and beyond. Built with vanilla HTML5, CSS3, and ES6 JavaScript — zero build step, 100% offline capable, and instantly deployable to **GitHub Pages**.

---

## ✨ Key Features

### 1. Multi-Type Card System
- **Basic (Front / Back)**: Clean question & answer format with optional hints.
- **Reversible (Two-Way)**: Quizzes both directions (Front ➔ Back and Back ➔ Front) to reinforce bidirectional recall.
- **Cloze Deletion**: Anki-style text cloze (`{{c1::answer}}`) with a dedicated "Make Cloze" formatting tool in the card editor. In study mode, terms are hidden as `[ ... ]` until revealed.
- **Image Cards**: Prompts with embedded diagrams, photographs, or formulas. Supports file upload, clipboard paste (`Ctrl+V`), and URL links.
- **Image Occlusion Cards**: Built-in canvas tool allowing students to upload or paste a diagram (e.g. animal cell, world map, physics apparatus) and draw interactive occlusion masks over labels. During review, target boxes prompt recall with interactive reveal.

### 2. Hierarchical Organization (Folders & Decks)
- Unlimited nested hierarchy: **Class ➔ Unit ➔ Lesson ➔ Concept ➔ ...**
- Tree-view folder navigator with expand/collapse and real-time badge counts of **Total Cards** and **Due Cards**.
- Move, rename, or delete folders at any level.

### 3. Study Modes & Spaced Repetition (SRS)
- **Daily Review (Anki SM-2 Spaced Repetition)**:
  - Back-off spacing algorithm: cards answered well are scheduled further apart; difficult cards back off for quicker re-review.
  - 4 recall rating buttons with live interval previews:
    - **Again [1]** (`< 10m` or `1d`) — lapses, drops ease factor, re-queues.
    - **Hard [2]** (slight interval increase, ease penalty).
    - **Good [3]** (standard SM-2 interval expansion).
    - **Easy [4]** (bonus interval multiplier, boosts ease factor).
  - Adapts in real-time as reviews are completed.
- **Endless Practice (Cram / Free Practice)**:
  - Rapid-fire study through any deck or folder without affecting your daily SRS schedule.
- **Group / Branch Review**:
  - Filter reviews to a specific subject, unit, or lesson branch with one click.
- **Keyboard Shortcuts**:
  - `Space` / `Enter`: Flip card / Reveal answer.
  - `1`, `2`, `3`, `4`: Select rating.

### 4. Progress Tracking & Secondary Student Focus
- Clean, energetic UI with distraction-free study arena.
- **Daily Goal Progress Bar** & **Streak Counter (🔥)** to build consistent study habits.
- End-of-session celebration with animated confetti and session statistics (Accuracy, Time spent, Cards reviewed).
- Light and Dark appearance themes.

### 5. Sharing & Export / Import
- **Export to JSON**: Download individual folder branches or entire collections to share with peers.
- **Import from JSON**: Easily import decks shared by teachers or classmates with merge or replace options.
- Architecture abstracted in `storage.js` to seamlessly hook into **Firebase Firestore / Realtime Database** in Phase 2 for live collaborative sets and online sharing.

---

## 🚀 Live GitHub Pages Deployment Guide

Because StudyCards is built with standard web technologies without node bundler requirements, publishing it live to GitHub Pages takes less than a minute:

1. **Initialize Git & Commit**:
   ```bash
   git init
   git add .
   git commit -m "Initial commit of StudyCards"
   ```

2. **Create a Repository on GitHub**:
   - Go to [GitHub](https://github.com) and click **New repository** (e.g., `flash-cards`).
   - Leave it empty (do not initialize with README since you already have one).

3. **Push to GitHub**:
   ```bash
   git remote add origin https://github.com/<YOUR_USERNAME>/<REPO_NAME>.git
   git branch -M main
   git push -u origin main
   ```

4. **Enable GitHub Pages**:
   - Go to your repository on GitHub.
   - Click **Settings** ➔ **Pages** (in the left sidebar).
   - Under **Build and deployment > Source**, select **Deploy from a branch**.
   - Under **Branch**, select `main` and folder `/ (root)`.
   - Click **Save**.
   - Your site will be live at: `https://<YOUR_USERNAME>.github.io/<REPO_NAME>/`!

---

## 🛠️ Local Development & Testing

To run locally on your computer:

```bash
# Using Python
python -m http.server 8080

# Or open index.html directly in any modern web browser
```
Visit `http://localhost:8080` in your web browser.

---

## 📂 Project Architecture

```
Flash_Cards/
├── index.html              # Main single-page application shell
├── css/
│   ├── main.css            # Design tokens, variables, typography, navbar
│   ├── components.css      # Buttons, badges, tree view, hero banner, modals
│   ├── study.css           # 3D flip card, SM-2 buttons, occlusion styling, confetti
│   └── responsive.css       # Mobile & tablet responsive adaptations
├── js/
│   ├── app.js              # Application entry point & router
│   ├── srs.js              # SuperMemo-2 spaced repetition engine & intervals
│   ├── models.js           # Data schemas, default decks & cell diagram SVG
│   ├── storage.js          # IndexedDB service with localStorage fallback & JSON I/O
│   ├── occlusionCanvas.js  # Canvas & SVG image occlusion editor & study viewer
│   └── ui/
│       ├── dashboardView.js # Hero review banner, streak widget, classes grid
│       ├── treeView.js      # Hierarchical folder manager & card lists
│       ├── cardEditor.js    # Card creation modal (all 5 card types)
│       ├── studyView.js     # Study session controller (Daily, Endless, Group)
│       └── modal.js         # Folder management, JSON import/export, user settings
└── README.md
```

---

## 🔮 Phase 2 Roadmap: Firebase Integration

The storage layer (`storage.js`) is organized with decoupled asynchronous interfaces:
- **Authentication**: Firebase Auth (Sign in with Google / Email for secondary students).
- **Cloud Sync**: Dual-sync between IndexedDB and Firebase Firestore.
- **Public Deck Marketplace**: Browse and copy community-contributed decks.
- **Real-time Collaboration**: Shared class decks managed by teachers or study groups.
