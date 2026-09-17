/*
 * Chessbook — functional layer
 * -----------------------------------------------------------------------
 * This file implements ONLY behavior. It does not alter the supplied
 * index.html / style.css visual design. Any DOM elements created here
 * are inserted into the designated functional containers and styled
 * with inline styles that reference the existing CSS custom properties
 * (var(--ink), var(--gold), etc.) so they inherit the existing look
 * without touching style.css.
 *
 * PERSISTENCE: localStorage only, for now. See the "SUPABASE" note at
 * the bottom of this file (and the chat reply) for what's needed before
 * wiring the existing Supabase project in.
 *
 * This is a manual chess DEVELOPMENT RECORDER, not a chess engine:
 * - No move legality validation
 * - No move generation, suggestions, or automatic play
 * - "Position after every move" = the ordered move list up to that
 *   point (sufficient to reconstruct the game on a real board), since
 *   there is no board/engine tracking actual piece squares.
 */

(function () {
  'use strict';

  // ---------------------------------------------------------------------
  // STORAGE
  // ---------------------------------------------------------------------

  var STORAGE_KEY = 'chessbook_state_v1';

  function loadState() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return { pages: [], nextPageNumber: 1 };
      var parsed = JSON.parse(raw);
      if (!parsed || !Array.isArray(parsed.pages)) {
        return { pages: [], nextPageNumber: 1 };
      }
      if (typeof parsed.nextPageNumber !== 'number') {
        parsed.nextPageNumber = parsed.pages.length + 1;
      }
      parsed.pages.forEach(function (p) {
        if (!Array.isArray(p.moves)) p.moves = [];
        if (!Array.isArray(p.redoStack)) p.redoStack = [];
        if (typeof p.title !== 'string') p.title = '';
        if (typeof p.notes !== 'string') p.notes = '';
      });
      return parsed;
    } catch (e) {
      console.error('Chessbook: failed to load saved state', e);
      return { pages: [], nextPageNumber: 1 };
    }
  }

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      console.error('Chessbook: failed to save state', e);
    }
  }

  var state = loadState();

  // ---------------------------------------------------------------------
  // DOM REFERENCES (existing, locked elements only)
  // ---------------------------------------------------------------------

  var el = {
    bookApp: document.getElementById('book-app'),
    bookCover: document.getElementById('book-cover'),
    bookStage: document.getElementById('book-stage'),
    book: document.getElementById('book'),

    contentsPage: document.getElementById('contents-page'),
    contentsList: document.getElementById('contents-list'),
    contentsEmptyState: document.getElementById('contents-empty-state'),
    contentsSearchBtn: document.getElementById('contents-search'),

    notebookPage: document.getElementById('notebook-page'),
    notebookTitle: document.getElementById('notebook-title'),
    backToContents: document.getElementById('back-to-contents'),

    chessBoardContainer: document.getElementById('chess-board-container'),
    moveHistoryPanel: document.getElementById('move-history-panel'),
    moveHistoryList: document.getElementById('move-history-list'),

    notebookNotes: document.getElementById('notebook-notes'),
    notebookPageNumber: document.getElementById('notebook-page-number'),

    previousPageBtn: document.getElementById('previous-page'),
    nextPageBtn: document.getElementById('next-page'),
    currentPageNumberLabel: document.getElementById('current-page-number'),
  };

  // ---------------------------------------------------------------------
  // RUNTIME (non-persisted) STATE
  // ---------------------------------------------------------------------

  var currentView = 'cover'; // 'cover' | 'contents' | 'notebook'
  var currentPageId = null;
  var searchQuery = '';
  var searchInputEl = null;
  var searchOpen = false;

  // Per-page replay cursor: cursor === moves.length means "live" (editable).
  // cursor < moves.length means reviewing an earlier point in the game.
  var replayState = {};

  // ---------------------------------------------------------------------
  // SMALL DOM HELPERS
  // ---------------------------------------------------------------------

  function clearChildren(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  function styleMoveInput(input) {
    input.style.flex = '1';
    input.style.minWidth = '0';
    input.style.padding = '5px 8px';
    input.style.border = '1px solid rgba(79, 56, 36, 0.25)';
    input.style.borderRadius = '2px';
    input.style.background = 'rgba(255, 250, 237, 0.35)';
    input.style.color = 'var(--ink)';
    input.style.fontFamily = 'Georgia, "Times New Roman", serif';
    input.style.fontSize = '13px';
    input.style.outline = 'none';
  }

  function styleSmallButton(btn) {
    btn.style.padding = '4px 10px';
    btn.style.border = '1px solid rgba(184, 149, 74, 0.5)';
    btn.style.borderRadius = '2px';
    btn.style.background = 'rgba(184, 149, 74, 0.12)';
    btn.style.color = 'var(--ink)';
    btn.style.fontFamily = 'Arial, Helvetica, sans-serif';
    btn.style.fontSize = '11px';
    btn.style.letterSpacing = '0.03em';
    btn.style.cursor = 'pointer';
  }

  function mkTextButton(id, label) {
    var b = document.createElement('button');
    b.type = 'button';
    b.id = id;
    b.textContent = label;
    styleSmallButton(b);
    return b;
  }

  // ---------------------------------------------------------------------
  // DATA HELPERS
  // ---------------------------------------------------------------------

  function getPage(id) {
    for (var i = 0; i < state.pages.length; i++) {
      if (state.pages[i].id === id) return state.pages[i];
    }
    return null;
  }

  function sortedPages() {
    return state.pages.slice().sort(function (a, b) {
      return a.pageNumber - b.pageNumber;
    });
  }

  function makePageId() {
    return 'p_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
  }

  // ---------------------------------------------------------------------
  // MOVE RECORDING (manual, both sides, no engine)
  // ---------------------------------------------------------------------

  function ensureLiveCursor(pageId) {
    var page = getPage(pageId);
    if (!page) return;
    replayState[pageId] = { cursor: page.moves.length };
  }

  function addPly(pageId, san) {
    var page = getPage(pageId);
    if (!page) return;
    san = (san || '').trim();
    if (!san) return;

    var isWhiteTurn = page.moves.length % 2 === 0;
    var moveNumber = Math.floor(page.moves.length / 2) + 1;

    page.moves.push({
      color: isWhiteTurn ? 'w' : 'b',
      san: san,
      moveNumber: moveNumber,
    });
    page.redoStack = [];

    ensureLiveCursor(pageId);
    saveState();
    renderNotebookMoves(pageId);
  }

  function undoPly(pageId) {
    var page = getPage(pageId);
    if (!page || page.moves.length === 0) return;
    var last = page.moves.pop();
    page.redoStack.push(last);
    ensureLiveCursor(pageId);
    saveState();
    renderNotebookMoves(pageId);
  }

  function redoPly(pageId) {
    var page = getPage(pageId);
    if (!page || page.redoStack.length === 0) return;
    var ply = page.redoStack.pop();
    page.moves.push(ply);
    ensureLiveCursor(pageId);
    saveState();
    renderNotebookMoves(pageId);
  }

  function resetPage(pageId) {
    var page = getPage(pageId);
    if (!page || page.moves.length === 0) return;
    var ok = window.confirm('Clear every recorded move on this page? This cannot be undone.');
    if (!ok) return;
    page.moves = [];
    page.redoStack = [];
    replayState[pageId] = { cursor: 0 };
    saveState();
    renderNotebookMoves(pageId);
  }

  function replayStep(pageId, delta) {
    var page = getPage(pageId);
    if (!page) return;
    if (!replayState[pageId]) replayState[pageId] = { cursor: page.moves.length };
    var rs = replayState[pageId];
    rs.cursor = Math.max(0, Math.min(page.moves.length, rs.cursor + delta));
    renderNotebookMoves(pageId);
    updateEntryLockUI(pageId);
  }

  function replayGoLive(pageId) {
    var page = getPage(pageId);
    if (!page) return;
    replayState[pageId] = { cursor: page.moves.length };
    renderNotebookMoves(pageId);
    updateEntryLockUI(pageId);
  }

  function commitFromInputs(pageId) {
    var page = getPage(pageId);
    if (!page) return;
    var rs = replayState[pageId] || { cursor: page.moves.length };
    if (rs.cursor !== page.moves.length) return; // locked while reviewing

    var whiteInput = document.getElementById('move-input-white');
    var blackInput = document.getElementById('move-input-black');
    var isWhiteTurn = page.moves.length % 2 === 0;

    if (isWhiteTurn) {
      var wVal = whiteInput.value.trim();
      if (!wVal) { whiteInput.focus(); return; }
      addPly(pageId, wVal);
      whiteInput.value = '';
      blackInput.focus();
    } else {
      var bVal = blackInput.value.trim();
      if (!bVal) { blackInput.focus(); return; }
      addPly(pageId, bVal);
      blackInput.value = '';
      whiteInput.focus();
    }
    updateEntryLockUI(pageId);
  }

  // ---------------------------------------------------------------------
  // MOVE HISTORY RENDERING
  // ---------------------------------------------------------------------

  function renderNotebookMoves(pageId) {
    var page = getPage(pageId);
    if (!page) return;
    var rs = replayState[pageId] || { cursor: page.moves.length };

    clearChildren(el.moveHistoryList);

    for (var i = 0; i < page.moves.length; i += 2) {
      var whitePly = page.moves[i];
      var blackPly = page.moves[i + 1];

      var row = document.createElement('div');
      row.className = 'move-row';

      var numEl = document.createElement('span');
      numEl.className = 'move-number';
      numEl.textContent = whitePly.moveNumber + '.';

      var whiteEl = document.createElement('span');
      whiteEl.className = 'move-white';
      whiteEl.textContent = whitePly.san;
      if (i >= rs.cursor) whiteEl.style.opacity = '0.32';
      if (i === rs.cursor - 1) whiteEl.style.textDecoration = 'underline';

      var blackEl = document.createElement('span');
      blackEl.className = 'move-black';
      if (blackPly) {
        blackEl.textContent = blackPly.san;
        if (i + 1 >= rs.cursor) blackEl.style.opacity = '0.32';
        if (i + 1 === rs.cursor - 1) blackEl.style.textDecoration = 'underline';
      }

      row.appendChild(numEl);
      row.appendChild(whiteEl);
      row.appendChild(blackEl);
      el.moveHistoryList.appendChild(row);
    }

    if (rs.cursor === page.moves.length) {
      el.moveHistoryList.scrollTop = el.moveHistoryList.scrollHeight;
    }
  }

  function updateEntryLockUI(pageId) {
    var page = getPage(pageId);
    if (!page) return;
    var rs = replayState[pageId] || { cursor: page.moves.length };
    var reviewing = rs.cursor !== page.moves.length;

    var whiteInput = document.getElementById('move-input-white');
    var blackInput = document.getElementById('move-input-black');
    var addBtn = document.getElementById('move-add-btn');
    var continueBtn = document.getElementById('continue-btn');

    continueBtn.style.display = reviewing ? '' : 'none';
    addBtn.disabled = reviewing;

    if (reviewing) {
      whiteInput.disabled = true;
      blackInput.disabled = true;
    } else {
      var isWhiteTurn = page.moves.length % 2 === 0;
      whiteInput.disabled = !isWhiteTurn;
      blackInput.disabled = isWhiteTurn;
    }

    document.getElementById('undo-btn').disabled = page.moves.length === 0;
    document.getElementById('redo-btn').disabled = page.redoStack.length === 0;
    document.getElementById('reset-btn').disabled = page.moves.length === 0;
    document.getElementById('replay-prev-btn').disabled = rs.cursor === 0;
    document.getElementById('replay-next-btn').disabled = rs.cursor === page.moves.length;
  }

  // ---------------------------------------------------------------------
  // MOVE CONTROLS (functional child elements, inserted once into the
  // locked move-history-panel container)
  // ---------------------------------------------------------------------

  function buildMoveControls() {
    var wrap = document.createElement('div');
    wrap.id = 'move-controls';
    wrap.style.display = 'flex';
    wrap.style.flexDirection = 'column';
    wrap.style.gap = '7px';
    wrap.style.margin = '10px 0 12px';
    wrap.style.paddingBottom = '10px';
    wrap.style.borderBottom = '1px solid rgba(79, 56, 36, 0.2)';

    var entryRow = document.createElement('div');
    entryRow.style.display = 'flex';
    entryRow.style.gap = '6px';

    var whiteInput = document.createElement('input');
    whiteInput.type = 'text';
    whiteInput.id = 'move-input-white';
    whiteInput.placeholder = 'White';
    whiteInput.autocomplete = 'off';
    styleMoveInput(whiteInput);

    var blackInput = document.createElement('input');
    blackInput.type = 'text';
    blackInput.id = 'move-input-black';
    blackInput.placeholder = 'Black';
    blackInput.autocomplete = 'off';
    styleMoveInput(blackInput);

    var addBtn = mkTextButton('move-add-btn', 'Add');

    entryRow.appendChild(whiteInput);
    entryRow.appendChild(blackInput);
    entryRow.appendChild(addBtn);

    var controlRow = document.createElement('div');
    controlRow.style.display = 'flex';
    controlRow.style.flexWrap = 'wrap';
    controlRow.style.gap = '6px';

    var undoBtn = mkTextButton('undo-btn', 'Undo');
    var redoBtn = mkTextButton('redo-btn', 'Redo');
    var resetBtn = mkTextButton('reset-btn', 'Reset');
    var replayPrevBtn = mkTextButton('replay-prev-btn', '\u2039 Replay');
    var replayNextBtn = mkTextButton('replay-next-btn', 'Replay \u203A');
    var continueBtn = mkTextButton('continue-btn', 'Continue');
    continueBtn.style.display = 'none';

    [undoBtn, redoBtn, resetBtn, replayPrevBtn, replayNextBtn, continueBtn].forEach(function (b) {
      controlRow.appendChild(b);
    });

    wrap.appendChild(entryRow);
    wrap.appendChild(controlRow);
    return wrap;
  }

  function installMoveControls() {
    var controls = buildMoveControls();
    var heading = el.moveHistoryPanel.querySelector('.move-history-heading');
    el.moveHistoryPanel.insertBefore(controls, heading.nextSibling);
  }

  function wireMoveControlEvents() {
    document.getElementById('move-add-btn').addEventListener('click', function () {
      commitFromInputs(currentPageId);
    });
    document.getElementById('move-input-white').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); commitFromInputs(currentPageId); }
    });
    document.getElementById('move-input-black').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); commitFromInputs(currentPageId); }
    });
    document.getElementById('undo-btn').addEventListener('click', function () {
      undoPly(currentPageId); updateEntryLockUI(currentPageId);
    });
    document.getElementById('redo-btn').addEventListener('click', function () {
      redoPly(currentPageId); updateEntryLockUI(currentPageId);
    });
    document.getElementById('reset-btn').addEventListener('click', function () {
      resetPage(currentPageId); updateEntryLockUI(currentPageId);
    });
    document.getElementById('replay-prev-btn').addEventListener('click', function () {
      replayStep(currentPageId, -1);
    });
    document.getElementById('replay-next-btn').addEventListener('click', function () {
      replayStep(currentPageId, 1);
    });
    document.getElementById('continue-btn').addEventListener('click', function () {
      replayGoLive(currentPageId);
    });
  }

  // ---------------------------------------------------------------------
  // CONTENTS PAGE
  // ---------------------------------------------------------------------

  function renderContents() {
    clearChildren(el.contentsList);

    var titled = sortedPages().filter(function (p) {
      return p.title && p.title.trim();
    });

    var query = searchQuery.trim().toLowerCase();
    var visible = query
      ? titled.filter(function (p) { return p.title.toLowerCase().indexOf(query) !== -1; })
      : titled;

    el.contentsEmptyState.style.display = visible.length === 0 ? '' : 'none';

    visible.forEach(function (page) {
      var entry = document.createElement('div');
      entry.className = 'contents-entry';
      entry.setAttribute('role', 'button');
      entry.tabIndex = 0;
      entry.style.cursor = 'pointer';

      var titleEl = document.createElement('span');
      titleEl.className = 'contents-entry-title';
      titleEl.textContent = page.title;

      var numEl = document.createElement('span');
      numEl.className = 'contents-entry-page';
      numEl.textContent = String(page.pageNumber);

      entry.appendChild(titleEl);
      entry.appendChild(numEl);

      entry.addEventListener('click', function () {
        openNotebookPage(page.id, 'forward');
      });
      entry.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          openNotebookPage(page.id, 'forward');
        }
      });

      el.contentsList.appendChild(entry);
    });
  }

  function toggleContentsSearch() {
    searchOpen = !searchOpen;

    if (searchOpen) {
      if (!searchInputEl) {
        searchInputEl = document.createElement('input');
        searchInputEl.type = 'text';
        searchInputEl.id = 'contents-search-input';
        searchInputEl.placeholder = 'Search titles\u2026';
        searchInputEl.autocomplete = 'off';
        searchInputEl.style.width = '100%';
        searchInputEl.style.margin = '14px 0 0';
        searchInputEl.style.padding = '8px 10px';
        searchInputEl.style.border = '1px solid rgba(79, 56, 36, 0.25)';
        searchInputEl.style.borderRadius = '2px';
        searchInputEl.style.background = 'rgba(255, 250, 237, 0.35)';
        searchInputEl.style.color = 'var(--ink)';
        searchInputEl.style.fontFamily = 'Georgia, "Times New Roman", serif';
        searchInputEl.style.fontSize = '14px';
        searchInputEl.style.fontStyle = 'italic';
        searchInputEl.style.outline = 'none';
        searchInputEl.addEventListener('input', function () {
          searchQuery = searchInputEl.value;
          renderContents();
        });
        el.contentsList.parentNode.insertBefore(searchInputEl, el.contentsList);
      }
      searchInputEl.style.display = 'block';
      searchInputEl.focus();
    } else if (searchInputEl) {
      searchInputEl.style.display = 'none';
      searchInputEl.value = '';
      searchQuery = '';
      renderContents();
    }
  }

  // ---------------------------------------------------------------------
  // NAVIGATION / PAGE TURNING
  // ---------------------------------------------------------------------

  var turnTimeout = null;

  function showPage(pageEl, direction) {
    [el.contentsPage, el.notebookPage].forEach(function (p) {
      p.style.display = (p === pageEl) ? 'block' : 'none';
    });

    if (direction) {
      el.book.classList.remove('is-turning-forward', 'is-turning-backward');
      pageEl.classList.remove('page-enter-forward', 'page-enter-backward');
      // force reflow so the animation reliably restarts
      void pageEl.offsetWidth;

      var cls = direction === 'forward' ? 'is-turning-forward' : 'is-turning-backward';
      var enterCls = direction === 'forward' ? 'page-enter-forward' : 'page-enter-backward';
      el.book.classList.add(cls);
      pageEl.classList.add(enterCls);

      clearTimeout(turnTimeout);
      turnTimeout = setTimeout(function () {
        el.book.classList.remove('is-turning-forward', 'is-turning-backward');
        pageEl.classList.remove('page-enter-forward', 'page-enter-backward');
      }, 480);
    }

    updateNavButtons();
  }

  function updateNavButtons() {
    el.previousPageBtn.disabled = (currentView === 'contents');
  }

  function openContents(direction) {
    currentView = 'contents';
    currentPageId = null;
    el.currentPageNumberLabel.textContent = 'Contents';
    el.book.dataset.page = 'contents';
    renderContents();
    showPage(el.contentsPage, direction);
  }

  function openNotebookPage(pageId, direction) {
    var page = getPage(pageId);
    if (!page) return;

    currentView = 'notebook';
    currentPageId = pageId;
    el.book.dataset.page = 'notebook';

    el.notebookTitle.value = page.title || '';
    el.notebookNotes.value = page.notes || '';
    el.notebookPageNumber.textContent = String(page.pageNumber);
    el.currentPageNumberLabel.textContent = page.title ? page.title : ('Page ' + page.pageNumber);

    if (!replayState[pageId]) replayState[pageId] = { cursor: page.moves.length };

    renderNotebookMoves(pageId);
    updateEntryLockUI(pageId);
    showPage(el.notebookPage, direction);
  }

  function createAndOpenPage(direction) {
    var pageNumber = state.nextPageNumber++;
    var page = {
      id: makePageId(),
      pageNumber: pageNumber,
      title: '',
      notes: '',
      moves: [],
      redoStack: [],
    };
    state.pages.push(page);
    saveState();
    renderContents();
    openNotebookPage(page.id, direction);
  }

  function goNext() {
    var pages = sortedPages();

    if (currentView === 'contents') {
      if (pages.length === 0) {
        createAndOpenPage('forward');
      } else {
        openNotebookPage(pages[0].id, 'forward');
      }
      return;
    }

    if (currentView === 'notebook') {
      var idx = pages.findIndex(function (p) { return p.id === currentPageId; });
      if (idx === pages.length - 1) {
        createAndOpenPage('forward');
      } else {
        openNotebookPage(pages[idx + 1].id, 'forward');
      }
    }
  }

  function goPrevious() {
    if (currentView !== 'notebook') return;
    var pages = sortedPages();
    var idx = pages.findIndex(function (p) { return p.id === currentPageId; });

    if (idx <= 0) {
      openContents('backward');
    } else {
      openNotebookPage(pages[idx - 1].id, 'backward');
    }
  }

  // ---------------------------------------------------------------------
  // TOUCH SWIPE (left-to-right => previous, right-to-left => next)
  // ---------------------------------------------------------------------

  function wireSwipe() {
    var startX = null;
    var startY = null;

    el.book.addEventListener('touchstart', function (e) {
      if (e.touches.length !== 1) return;
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
    }, { passive: true });

    el.book.addEventListener('touchend', function (e) {
      if (startX === null) return;
      var t = e.changedTouches[0];
      var dx = t.clientX - startX;
      var dy = t.clientY - startY;
      startX = null;
      startY = null;

      if (Math.abs(dx) < 55) return;
      if (Math.abs(dx) < Math.abs(dy) * 1.3) return; // mostly vertical, ignore

      if (dx > 0) {
        goPrevious();
      } else {
        goNext();
      }
    }, { passive: true });
  }

  // ---------------------------------------------------------------------
  // TITLE / NOTES BINDINGS
  // ---------------------------------------------------------------------

  function wireTitleAndNotes() {
    el.notebookTitle.addEventListener('input', function () {
      var page = getPage(currentPageId);
      if (!page) return;
      page.title = el.notebookTitle.value;
      saveState();
      renderContents();
      el.currentPageNumberLabel.textContent = page.title ? page.title : ('Page ' + page.pageNumber);
    });

    var notesTimer = null;
    el.notebookNotes.addEventListener('input', function () {
      var page = getPage(currentPageId);
      if (!page) return;
      page.notes = el.notebookNotes.value;
      clearTimeout(notesTimer);
      notesTimer = setTimeout(saveState, 300);
    });
  }

  // ---------------------------------------------------------------------
  // TOP-LEVEL WIRING
  // ---------------------------------------------------------------------

  function wireCover() {
    el.bookCover.addEventListener('click', function () {
      el.bookCover.classList.add('hidden');
      el.bookStage.classList.remove('hidden');
      openContents(null);
    });
  }

  function wireNav() {
    el.previousPageBtn.addEventListener('click', goPrevious);
    el.nextPageBtn.addEventListener('click', goNext);
    el.backToContents.addEventListener('click', function () {
      openContents('backward');
    });
    el.contentsSearchBtn.addEventListener('click', toggleContentsSearch);
  }

  function init() {
    installMoveControls();
    wireMoveControlEvents();
    wireCover();
    wireNav();
    wireTitleAndNotes();
    wireSwipe();

    el.notebookPage.style.display = 'none';
    el.contentsPage.style.display = 'block';
    el.book.dataset.page = 'contents';
    updateNavButtons();
    renderContents();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // ---------------------------------------------------------------------
  // SUPABASE (not wired yet — see chat reply)
  // ---------------------------------------------------------------------
  //
  // The @supabase/supabase-js script tag is already loaded by index.html,
  // but no client is instantiated here yet, and nothing in this file
  // reads/writes notebook_pages. Local persistence (above) is fully
  // functional on its own in the meantime.
  //
  // To wire it in without touching the working logic above, I need:
  //   1. Your Supabase project URL and publishable (anon) key
  //   2. The exact column names on notebook_pages — specifically whether
  //      it already has a JSONB (or similar) column to hold the full
  //      ordered move list, plus columns for page_number, title, notes,
  //      and the RLS ownership column (e.g. user_id).
  //
  // Once I have that, the plan is: keep localStorage as an instant local
  // cache, and add a thin sync layer (debounced upsert to notebook_pages,
  // fetch-on-load) around the same state object — no changes needed to
  // the rendering/move logic above.
})();
