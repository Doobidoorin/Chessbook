(function () {
  'use strict';

  var STORAGE_KEY = 'chessbook_state_v1';

  var state = loadState();

  var currentView = 'cover';
  var currentPageId = null;
  var searchQuery = '';
  var searchInputEl = null;

  var replayState = {};

  var liveGame = new Chess();
  var board = null;

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

  function loadState() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        return { pages: [], nextPageNumber: 1 };
      }

      var parsed = JSON.parse(raw);
      if (!parsed || !Array.isArray(parsed.pages)) {
        return { pages: [], nextPageNumber: 1 };
      }

      if (typeof parsed.nextPageNumber !== 'number') {
        parsed.nextPageNumber = parsed.pages.length + 1;
      }

      parsed.pages.forEach(function (page) {
        if (!page) return;
        if (!Array.isArray(page.moves)) page.moves = [];
        if (!Array.isArray(page.redoStack)) page.redoStack = [];
        if (typeof page.title !== 'string') page.title = '';
        if (typeof page.notes !== 'string') page.notes = '';
      });

      return parsed;
    } catch (error) {
      console.error('Chessbook: failed to load saved state', error);
      return { pages: [], nextPageNumber: 1 };
    }
  }

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (error) {
      console.error('Chessbook: failed to save state', error);
    }
  }

  function getPage(id) {
    for (var i = 0; i < state.pages.length; i += 1) {
      if (state.pages[i].id === id) {
        return state.pages[i];
      }
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

  function clearChildren(node) {
    while (node.firstChild) {
      node.removeChild(node.firstChild);
    }
  }

  function buildMoveControls() {
    var wrap = document.createElement('div');
    wrap.className = 'move-controls';

    var controlRow = document.createElement('div');
    controlRow.className = 'move-control-row';

    var buttons = [
      { id: 'undo-btn', label: 'Undo' },
      { id: 'redo-btn', label: 'Redo' },
      { id: 'reset-btn', label: 'Reset' },
      { id: 'replay-prev-btn', label: '⟨ Replay' },
      { id: 'replay-next-btn', label: 'Replay ⟩' },
      { id: 'continue-btn', label: 'Continue' }
    ];

    buttons.forEach(function (buttonConfig) {
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'move-button';
      button.id = buttonConfig.id;
      button.textContent = buttonConfig.label;
      controlRow.appendChild(button);
    });

    wrap.appendChild(controlRow);
    return wrap;
  }

  function installMoveControls() {
    var controls = buildMoveControls();
    var heading = el.moveHistoryPanel.querySelector('.move-history-heading');
    if (heading && heading.nextSibling) {
      el.moveHistoryPanel.insertBefore(controls, heading.nextSibling);
    } else {
      el.moveHistoryPanel.appendChild(controls);
    }
  }

  function normalizeMoveObject(move, moveNumber) {
    var safeMove = {
      moveNumber: moveNumber,
      color: move.color,
      san: move.san,
      from: move.from,
      to: move.to,
      promotion: move.promotion || null,
      fen: move.fen || null
    };

    if (safeMove.fen === null) {
      safeMove.fen = new Chess().fen();
    }

    return safeMove;
  }

  function reconstructGameFromMoves(moves) {
    var game = new Chess();
    var movesToApply = Array.isArray(moves) ? moves : [];

    for (var i = 0; i < movesToApply.length; i += 1) {
      var entry = movesToApply[i];
      var moveConfig = {
        from: entry.from,
        to: entry.to,
        promotion: entry.promotion || 'q'
      };

      if (!entry || !entry.from || !entry.to) {
        continue;
      }

      try {
        game.move(moveConfig);
      } catch (error) {
        console.warn('Chessbook: failed to reconstruct position from saved move record', error);
      }
    }

    return game;
  }

  function getCurrentReviewCursor(pageId) {
    var page = getPage(pageId);
    if (!page) return 0;

    if (!replayState[pageId]) {
      replayState[pageId] = { cursor: page.moves.length };
    }

    return replayState[pageId].cursor;
  }

  function updateBoardFromGameState(gameState) {
    if (!board) return;

    try {
      board.position(gameState.fen());
    } catch (error) {
      console.warn('Chessbook: failed to render real chessboard state', error);
    }
  }

  function syncBoardToReplayState(pageId) {
    var page = getPage(pageId);
    if (!page) return;

    var cursor = getCurrentReviewCursor(pageId);
    var gameState = reconstructGameFromMoves(page.moves.slice(0, cursor));
    updateBoardFromGameState(gameState);
  }

  function syncBoardToLiveGame(pageId) {
    var page = getPage(pageId);
    if (!page) return;

    var liveState = reconstructGameFromMoves(page.moves);
    updateBoardFromGameState(liveState);
    liveGame = liveState;
  }

  function renderMoveHistory(pageId) {
    var page = getPage(pageId);
    if (!page) return;

    var cursor = getCurrentReviewCursor(pageId);
    clearChildren(el.moveHistoryList);

    for (var i = 0; i < page.moves.length; i += 1) {
      var entry = page.moves[i];
      var row = document.createElement('div');
      row.className = 'move-row';

      if (i >= cursor) {
        row.classList.add('dimmed');
      }

      if (i === cursor - 1 && cursor > 0) {
        row.classList.add('current');
      }

      var moveNumber = document.createElement('span');
      moveNumber.className = 'move-number';
      moveNumber.textContent = String(entry.moveNumber) + '.';

      var whiteMove = document.createElement('span');
      whiteMove.className = 'move-white';

      var blackMove = document.createElement('span');
      blackMove.className = 'move-black';

      if (entry.color === 'w') {
        whiteMove.textContent = entry.san;
        blackMove.textContent = '';
      } else {
        whiteMove.textContent = '';
        blackMove.textContent = entry.san;
      }

      row.appendChild(moveNumber);
      row.appendChild(whiteMove);
      row.appendChild(blackMove);
      el.moveHistoryList.appendChild(row);
    }

    if (page.moves.length === 0) {
      var empty = document.createElement('div');
      empty.className = 'move-row';
      empty.textContent = 'No moves recorded yet';
      empty.style.opacity = '0.5';
      el.moveHistoryList.appendChild(empty);
    }

    if (cursor >= page.moves.length) {
      el.moveHistoryList.scrollTop = el.moveHistoryList.scrollHeight;
    }
  }

  function updateEntryLockUI(pageId) {
    var page = getPage(pageId);
    if (!page) return;

    var reviewing = getCurrentReviewCursor(pageId) !== page.moves.length;

    var undoBtn = document.getElementById('undo-btn');
    var redoBtn = document.getElementById('redo-btn');
    var resetBtn = document.getElementById('reset-btn');
    var replayPrevBtn = document.getElementById('replay-prev-btn');
    var replayNextBtn = document.getElementById('replay-next-btn');
    var continueBtn = document.getElementById('continue-btn');

    if (!undoBtn || !redoBtn || !resetBtn || !replayPrevBtn || !replayNextBtn || !continueBtn) {
      return;
    }

    undoBtn.disabled = page.moves.length === 0;
    redoBtn.disabled = page.redoStack.length === 0;
    resetBtn.disabled = page.moves.length === 0;

    replayPrevBtn.disabled = getCurrentReviewCursor(pageId) === 0;
    replayNextBtn.disabled = getCurrentReviewCursor(pageId) === page.moves.length;

    continueBtn.style.display = reviewing ? 'inline-block' : 'none';

    var whiteInputFields = document.querySelectorAll('input[type=text]');
    whiteInputFields.forEach(function (input) {
      if (input.id && input.id.indexOf('move-input-white') === -1 && input.id.indexOf('move-input-black') === -1) {
        return;
      }
    });

    if (page.moves.length === 0) {
      return;
    }

    if (reviewing) {
      // Board is in review state: no new moves are allowed.
      return;
    }
  }

  function addPly(pageId, moveRecord) {
    var page = getPage(pageId);
    if (!page) return;

    page.moves.push(moveRecord);
    page.redoStack = [];

    replayState[pageId] = { cursor: page.moves.length };
    saveState();
    renderMoveHistory(pageId);
    syncBoardToLiveGame(pageId);
    updateEntryLockUI(pageId);
  }

  function undoPly(pageId) {
    var page = getPage(pageId);
    if (!page || page.moves.length === 0) return;

    var lastMove = page.moves.pop();
    page.redoStack.push(lastMove);

    replayState[pageId] = { cursor: page.moves.length };
    saveState();
    renderMoveHistory(pageId);
    syncBoardToReplayState(pageId);
    updateEntryLockUI(pageId);
  }

  function redoPly(pageId) {
    var page = getPage(pageId);
    if (!page || page.redoStack.length === 0) return;

    var nextMove = page.redoStack.pop();
    page.moves.push(nextMove);

    replayState[pageId] = { cursor: page.moves.length };
    saveState();
    renderMoveHistory(pageId);
    syncBoardToReplayState(pageId);
    updateEntryLockUI(pageId);
  }

  function resetPage(pageId) {
    var page = getPage(pageId);
    if (!page || page.moves.length === 0) return;

    var confirmed = window.confirm('Clear every recorded move on this page? This cannot be undone.');
    if (!confirmed) return;

    page.moves = [];
    page.redoStack = [];
    replayState[pageId] = { cursor: 0 };
    saveState();
    renderMoveHistory(pageId);
    syncBoardToReplayState(pageId);
    updateEntryLockUI(pageId);
  }

  function replayStep(pageId, delta) {
    var page = getPage(pageId);
    if (!page) return;

    if (!replayState[pageId]) {
      replayState[pageId] = { cursor: page.moves.length };
    }

    replayState[pageId].cursor = Math.max(0, Math.min(page.moves.length, replayState[pageId].cursor + delta));
    saveState();
    renderMoveHistory(pageId);
    syncBoardToReplayState(pageId);
    updateEntryLockUI(pageId);
  }

  function replayGoLive(pageId) {
    var page = getPage(pageId);
    if (!page) return;

    replayState[pageId] = { cursor: page.moves.length };
    saveState();
    renderMoveHistory(pageId);
    syncBoardToLiveGame(pageId);
    updateEntryLockUI(pageId);
  }

  function renderContents() {
    clearChildren(el.contentsList);

    var titled = sortedPages().filter(function (page) {
      return page && page.title && page.title.trim();
    });

    var query = searchQuery.trim().toLowerCase();
    var visible = query
      ? titled.filter(function (page) {
          return page.title.toLowerCase().indexOf(query) !== -1;
        })
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
    searchQuery = '';
    searchInputEl = searchInputEl || document.createElement('input');
    searchInputEl.type = 'text';
    searchInputEl.placeholder = 'Search titles…';
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

    if (!searchInputEl.parentNode) {
      el.contentsList.parentNode.insertBefore(searchInputEl, el.contentsList);
    }

    searchInputEl.style.display = searchInputEl.style.display === 'block' ? 'none' : 'block';
    if (searchInputEl.style.display === 'block') {
      searchInputEl.focus();
    } else {
      searchInputEl.value = '';
      renderContents();
    }
    searchInputEl.addEventListener('input', function () {
      searchQuery = searchInputEl.value;
      renderContents();
    });
  }

  function showPage(pageEl, direction) {
    [el.contentsPage, el.notebookPage].forEach(function (p) {
      p.style.display = (p === pageEl) ? 'block' : 'none';
    });

    if (direction) {
      el.book.classList.remove('is-turning-forward', 'is-turning-backward');
      pageEl.classList.remove('page-enter-forward', 'page-enter-backward');

      void pageEl.offsetWidth;

      var cls = direction === 'forward' ? 'is-turning-forward' : 'is-turning-backward';
      var enterCls = direction === 'forward' ? 'page-enter-forward' : 'page-enter-backward';
      el.book.classList.add(cls);
      pageEl.classList.add(enterCls);

      setTimeout(function () {
        el.book.classList.remove('is-turning-forward', 'is-turning-backward');
        pageEl.classList.remove('page-enter-forward', 'page-enter-backward');
      }, 480);
    }

    updateNavButtons();
  }

  function updateNavButtons() {
    el.previousPageBtn.disabled = currentView === 'contents';
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

    if (!replayState[pageId]) {
      replayState[pageId] = { cursor: page.moves.length };
    }

    renderMoveHistory(pageId);
    syncBoardToReplayState(pageId);
    updateEntryLockUI(pageId);
    showPage(el.notebookPage, direction);
  }

  function createAndOpenPage(direction) {
    var pageNumber = state.nextPageNumber;
    state.nextPageNumber += 1;

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
      var idx = pages.findIndex(function (page) {
        return page.id === currentPageId;
      });

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
    var idx = pages.findIndex(function (page) {
      return page.id === currentPageId;
    });

    if (idx <= 0) {
      openContents('backward');
    } else {
      openNotebookPage(pages[idx - 1].id, 'backward');
    }
  }

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
      if (Math.abs(dx) < Math.abs(dy) * 1.3) return;

      if (dx > 0) {
        goPrevious();
      } else {
        goNext();
      }
    }, { passive: true });
  }

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
      notesTimer = setTimeout(function () {
        saveState();
      }, 300);
    });
  }

  function wireBoardEvents() {
    if (!window.Chessboard) {
      return;
    }

    board = Chessboard('chessboard', {
      draggable: true,
      pieceTheme: 'https://images.chesscomfiles.com/chess-themes/pieces/neo/150/{piece}.png',
      sparePieces: false,
      position: 'start',
      orientation: 'white',
      showNotation: false,
      onDragStart: function (source, piece, position, orientation) {
        if (currentView !== 'notebook') {
          return false;
        }

        var page = getPage(currentPageId);
        if (!page) {
          return false;
        }

        var cursor = getCurrentReviewCursor(currentPageId);
        if (cursor !== page.moves.length) {
          return false;
        }

        var isWhitePiece = piece.charAt(0) === 'w';
        var currentTurn = page.moves.length % 2 === 0;

        if (isWhitePiece && currentTurn === false) {
          return false;
        }

        if (!isWhitePiece && currentTurn === true) {
          return false;
        }

        return true;
      },
      onDrop: function (source, target, piece, newPos, orientation) {
        if (currentView !== 'notebook') {
          return 'snapback';
        }

        var page = getPage(currentPageId);
        if (!page) return 'snapback';

        var cursor = getCurrentReviewCursor(currentPageId);
        if (cursor !== page.moves.length) {
          return 'snapback';
        }

        var gameState = reconstructGameFromMoves(page.moves);
        var move = gameState.move({
          from: source,
          to: target,
          promotion: 'q'
        });

        if (!move) {
          return 'snapback';
        }

        var record = normalizeMoveObject({
          color: move.color,
          san: move.san,
          from: move.from,
          to: move.to,
          promotion: move.promotion || null,
          fen: gameState.fen(),
          moveNumber: Math.floor(page.moves.length / 2) + 1
        }, Math.floor(page.moves.length / 2) + 1);

        page.moves.push(record);
        page.redoStack = [];
        replayState[currentPageId] = { cursor: page.moves.length };

        saveState();
        renderMoveHistory(currentPageId);
        syncBoardToReplayState(currentPageId);
        updateEntryLockUI(currentPageId);

        return true;
      }
    });

    syncBoardToReplayState(currentPageId || null);
  }

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

  function installBoard() {
    if (!window.Chessboard || !window.Chess) {
      return;
    }

    wireBoardEvents();
  }

  function init() {
    installMoveControls();
    installBoard();
    wireCover();
    wireNav();
    wireTitleAndNotes();
    wireSwipe();

    el.notebookPage.style.display = 'none';
    el.contentsPage.style.display = 'block';
    el.book.dataset.page = 'contents';
    updateNavButtons();
    renderContents();

    if (currentPageId) {
      syncBoardToReplayState(currentPageId);
    }
  }

  function persistOnVisibilityChange() {
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') {
        saveState();
      }
    });

    window.addEventListener('beforeunload', function () {
      saveState();
    });
  }

  function bindControlEvents() {
    var undoBtn = document.getElementById('undo-btn');
    var redoBtn = document.getElementById('redo-btn');
    var resetBtn = document.getElementById('reset-btn');
    var replayPrevBtn = document.getElementById('replay-prev-btn');
    var replayNextBtn = document.getElementById('replay-next-btn');
    var continueBtn = document.getElementById('continue-btn');

    if (!undoBtn || !redoBtn || !resetBtn || !replayPrevBtn || !replayNextBtn || !continueBtn) {
      return;
    }

    undoBtn.addEventListener('click', function () {
      undoPly(currentPageId);
    });

    redoBtn.addEventListener('click', function () {
      redoPly(currentPageId);
    });

    resetBtn.addEventListener('click', function () {
      resetPage(currentPageId);
    });

    replayPrevBtn.addEventListener('click', function () {
      replayStep(currentPageId, -1);
    });

    replayNextBtn.addEventListener('click', function () {
      replayStep(currentPageId, -1);
    });

    continueBtn.addEventListener('click', function () {
      replayGoLive(currentPageId);
    });
  }

  function finalizeSetup() {
    bindControlEvents();
    persistOnVisibilityChange();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      finalizeSetup();
      init();
    });
  } else {
    finalizeSetup();
    init();
  }
})();
