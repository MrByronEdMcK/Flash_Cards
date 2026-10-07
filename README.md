# 🎴 StudyCards

**StudyCards** is a smart, distraction-free flashcard application designed to make studying efficient, engaging, and rewarding. Powered by scientifically backed spaced repetition, StudyCards helps you memorize facts, diagrams, formulas, and vocabulary for the long term.

It runs directly in your web browser and can be installed as an offline desktop app on **Chromebooks**, **Mac**, and **Windows**. All your cards, folders, and study progress are stored locally and privately on your device.

---

## 🚀 Getting Started

### Opening & Installing the App
* **In Your Browser**: Open StudyCards in Google Chrome or any modern browser.
* **Install as a Desktop App**:
  1. Open StudyCards in Google Chrome.
  2. Click the **Install App** button in the top navigation bar (or click the install icon in the right side of Chrome's address bar).
  3. StudyCards will launch in its own clean, standalone app window with its own desktop or app shelf icon.
* **Works 100% Offline**: Once loaded or installed, you can study anywhere without an internet connection.

---

## ✨ Key Features

### 1. Diverse Card Types
StudyCards supports five distinct flashcard styles to match how you learn:

* **Basic (Question & Answer)**: Classic flashcards for definitions, concepts, and trivia, with optional hints.
* **Reversible (Two-Way)**: Perfect for learning languages and paired facts. Automatically tests you in both directions (e.g., *English ➔ Spanish* and *Spanish ➔ English*).
* **Cloze Deletion (Fill-in-the-Blank)**: Hide key terms in a sentence using `{{c1::term}}` syntax (or highlight text and click the **Make Cloze** button in the editor). During study, terms are hidden as `[ ... ]` until you reveal them.
* **Image Cards**: Embed high-resolution diagrams, photos, or mathematical formulas. You can paste images straight from your clipboard (`Ctrl+V` / `Cmd+V`) or upload image files.
* **Image Occlusion**: Master anatomical diagrams, maps, or technical charts. Simply upload an image and draw clickable colored boxes over labels. When reviewing, each box acts as an interactive prompt that hides the label until you tap to reveal it.

---

### 2. Flexible Organization (Folders & Decks)
Keep all your subjects neat and organized:

* **Nested Folders**: Structure your study materials by **Subject ➔ Unit ➔ Lesson ➔ Topic** (e.g., *Biology ➔ Unit 1: Cells ➔ Lesson 2: Organelles*).
* **Drag-and-Drop Reorganization**: Easily rearrange folders, lessons, and decks in the left sidebar by dragging them into your preferred order or dropping them inside parent folders.
* **Live Status Badges**: See exactly how many cards are due for review and how many total cards exist in each folder at a glance.

---

### 3. Smart Spaced Repetition (SRS)
StudyCards uses the proven SuperMemo (SM-2) spaced repetition algorithm:

* **Daily Review**: Cards you find challenging appear more frequently, while cards you know well are spaced days, weeks, or months apart. This ensures you review each concept right before you would naturally forget it.
* **4-Button Recall Ratings**:
  * **Again (1)**: If you forgot the card, it resets for a quick re-test.
  * **Hard (2)**: You remembered, but with significant effort.
  * **Good (3)**: Successful recall with appropriate spacing.
  * **Easy (4)**: Instant recall; gives a bonus interval boost.
* **Study Focus Filter**: Have a test coming up in Chemistry or Spanish? Use the **Study Focus** tool on your Dashboard to focus your daily review session on specific subjects or units.
* **Endless Practice (Free Cram Mode)**: Want to do a quick rapid-fire review before a quiz? Endless Practice lets you quiz any deck repeatedly without interfering with your long-term spaced repetition schedule.
* **30-Day Forecast**: View an interactive chart on your Dashboard that illustrates how your upcoming reviews are distributed over the next month.

---

### 4. Build Daily Study Habits
* **Daily Goal**: Set a target number of cards to complete each day and watch your progress bar fill up.
* **Study Streaks (🔥)**: Keep your daily streak alive by reviewing your cards every day.
* **Celebration & Insights**: Finish your daily review set to enjoy celebration confetti and view your session summary, including total review time and accuracy.
* **Themes & Accent Colors**: Personalize your workspace with **Light** and **Dark** modes and choose from vibrant accent colors (Terracotta, Sage Green, Ocean Blue, Dusty Rose, Golden Amber, Crimson Brick, or Warm Plum).

---

## ⌨️ Keyboard Shortcuts

Speed through your reviews with intuitive keyboard shortcuts:

| Key | Action |
| :--- | :--- |
| `Space` or `Enter` | Flip card / Reveal answer |
| `1` | Rate **Again** (Forgot) |
| `2` | Rate **Hard** |
| `3` | Rate **Good** |
| `4` | Rate **Easy** |
| `Esc` | Exit study session back to Dashboard |

---

## 📥 Multi-Service Import & Backup

* **Import From Everywhere**: Seamlessly migrate flashcard decks into StudyCards from:
  * **Quizlet**: Copy exported text or upload Quizlet `.txt`/`.tsv`/`.csv` files.
  * **Anki**: Import Anki plain text notes (`.txt`, `.tsv`) with full HTML formatting and automatic conversion of Anki Cloze deletions (`{{c1::...}}`).
  * **RemNote**: Import RemNote Markdown and Text exports with Basic (`::`), Reversible (`:::`), multiline (`;;`), and Cloze (`{{...}}`) cards.
  * **Brainscape**: Upload Brainscape `.csv` export files.
  * **Cram.com**: Import Cram tab-delimited or comma-delimited card sets with optional hints.
  * **Knowt**: Import Quizlet-formatted text, CSV, or Knowt JSON exports.
  * **Universal CSV / TSV**: Import any spreadsheet or text file separated by tabs, commas, or semicolons.
  * **StudyCards Backup**: Restore native `.json` backup files.
* **Flexible Input Methods**: Upload a file (`.txt`, `.tsv`, `.csv`, `.json`, `.md`) or simply paste copied text straight into the app.
* **Smart Live Preview & Validation**: As you paste or upload, StudyCards automatically detects the format, displays the count of valid cards and card types (Basic, Cloze, Reversible), previews sample cards, and warns you if any rows have missing answers or formatting errors.
* **Import Digest**: Once imported, review a clear digest of cards added, destination deck, and an itemized breakdown of any skipped lines.
* **100% Private & Local**: Your flashcards, images, and progress are stored safely inside your browser's local database. No cloud subscriptions or accounts required.
* **Backup to File**: Click **Import / Export** in the navigation bar to export your entire flashcard collection (or individual folders) to a single backup file that you can save to Google Drive or your computer.
