(function () {
  'use strict';

  var STORAGE_KEY = 'chessbook_state_v1';

  var state = loadState();

  var currentView = 'cover';
  var currentPageId = null;
  var searchQuery = '';
  var searchInputEl = null;

  var replayState = {};

  var board = null;

  var el = {
    bookCover: document.getElementById('book-cover'),
    bookStage: document.getElementById('book-stage'),
    book: document.getElementById('book'),

    contentsPage: document.getElementById('contents-page'),
    contentsList: document.getElementById('contents-list'),
    contentsEmptyState: document.getElementById('contents-empty-state'),
    contentsSearchBtn: document.getElementById('contents-search'),

    notebookPage: document.getElementById('notebook-page'),
    notebookTitle: document.getElementById('notebook-title'),
    backToContents: document.getElementById('book-stage').querySelector('#back-to-contents'),

    moveHistoryPanel: document.getElementById('move-history-panel'),
    moveHistoryList: document.getElementById('move-history-list'),
    notes: document.getElementById('notebook-notes'),
    pageNumber: document.getElementById('notebook-page-number'),

    previous: document.getElementById('previous-page'),
    next: document.getElementById('next-page'),
    pageLabel: document.getElementById('current-page-number'),
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
        page.title = typeof page.title === 'string' ? page.title : '';
        page.notes = typeof page.notes === 'string' ? page.notes : '';
        page.moves = Array.isArray(page.moves) ? page.moves : [];
        page.redoStack = Array.isArray(page.redoStack) ? page.redoStack : [];
      });

      return parsed;
    } catch (error) {
      console.error('Chessbook: failed to load local notebook', error);
      return { pages: [], nextPageNumber: 1 };
    }
  }

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (error) {
      console.error('Chessbook: failed to save local notebook', error);
    }
  }

  function pageById(id) {
    return state.pages.find(function (page) {
      return page.id === id;
    }) || null;
  }

  function pagesInOrder() {
    return state.pages.slice().sort(function (a, b) {
      return a.pageNumber - b.pageNumber;
    });
  }

  function newPageId() {
    return 'p_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
  }

  function clear(node) {
    while (node.firstChild) {
      node.removeChild(node.firstChild);
    }
  }

  function gameFromMoves(moves) {
    var game = new Chess();
    (moves || []).forEach(function (entry) {
      if (!entry || !entry.from || !entry.to) {
        return;
      }
      try {
        game.move({
          from: entry.from,
          to: entry.to,
          promotion: entry.promotion || 'q'
        });
      } catch (error) {
        console.warn('Chessbook: skipped invalid saved move', entry, error);
      }
    });
    return game;
  }

  function cursorFor(page) {
    if (!replayState[page.id]) {
      replayState[page.id] = { cursor: page.moves.length };
    }
    return replayState[page.id].cursor;
  }

  function renderBoard(page) {
    if (!board || !page) {
      return;
    }

    var game = gameFromMoves(page.moves.slice(0, cursorFor(page)));
    board.position(game.fen(), false);
    window.requestAnimationFrame(function () {
      if (board) {
        board.resize();
      }
    });
  }

  function renderMoves(page) {
    if (!page) {
      return;
    }

    var cursor = cursorFor(page);
    clear(el.moveHistoryList);

    if (!page.moves.length) {
      var empty = document.createElement('div');
      empty.className = 'move-row';
      empty.textContent = 'No moves recorded yet';
      empty.style.opacity = '0.5';
      el.moveHistoryList.appendChild(empty);
      return;
    }

    for (var i = 0; i < page.moves.length; i += 2) {
      var row = document.createElement('div');
      row.className = 'move-row';

      if (i >= cursor) {
        row.classList.add('dimmed');
      }

      if (cursor > 0 && (i === cursor - 1 || i + 1 === cursor - 1)) {
        row.classList.add('current');
      }

      var number = document.createElement('span');
      number.className = 'move-number';
      number.textContent = page.moves[i].moveNumber + '.';

      var white = document.createElement('span');
      white.className = 'move-white';
      white.textContent = page.moves[i].color === 'w' ? page.moves[i].san : '';

      var black = document.createElement('span');
      black.className = 'move-black';
      black.textContent = page.moves[i + 1] && page.moves[i + 1].color === 'b' ? page.moves[i + 1].san : '';

      row.appendChild(number);
      row.appendChild(white);
      row.appendChild(black);
      el.moveHistoryList.appendChild(row);
    }

    if (cursor === page.moves.length) {
      el.moveHistoryList.scrollTop = el.moveHistoryList.scrollHeight;
    }
  }

  function updateControls(page) {
    var cursor = cursorFor(page);
    var ids = ['undo-btn', 'redo-btn', 'reset-btn', 'replay-prev-btn', 'replay-next-btn', 'continue-btn'];
    var buttons = {};
    ids.forEach(function (id) {
      buttons[id] = document.getElementById(id);
    });

    buttons['undo-btn'].disabled = page.moves.length === 0;
    buttons['redo-btn'].disabled = page.redoStack.length === 0;
    buttons['reset-btn'].disabled = page.moves.length === 0;
    buttons['replay-prev-btn'].disabled = cursor === 0;
    buttons['replay-next-btn'].disabled = cursor === page.moves.length;
    buttons['continue-btn'].style.display = cursor === page.moves.length ? 'none' : 'inline-block';

    // Keep controls usable on mobile.
    if (window.innerWidth <= 760) {
      buttons['replay-prev-btn'].style.fontSize = '10px';
      buttons['replay-next-btn'].style.fontSize = '10px';
    }
  }

  function refreshPage(page) {
    renderMoves(page);
    renderBoard(page);
    updateControls(page);
    saveState();
  }

  function recordMove(source, target) {
    var page = pageById(currentPageId);
    if (!page || cursorFor(page) !== page.moves.length) {
      return 'snapback';
    }

    var game = gameFromMoves(page.moves);
    var move;

    try {
      move = game.move({
        from: source,
        to: target,
        promotion: 'q'
      });
    } catch (error) {
      move = null;
    }

    if (!move) {
      return 'snapback';
    }

    page.moves.push({
      moveNumber: Math.floor(page.moves.length / 2) + 1,
      color: move.color,
      san: move.san,
      from: move.from,
      to: move.to,
      promotion: move.promotion || null,
      fen: game.fen()
    });
    page.redoStack = [];
    replayState[page.id] = { cursor: page.moves.length };
    refreshPage(page);
    return true;
  }

  function buildControls() {
    var wrap = document.createElement('div');
    wrap.className = 'move-controls';

    var row = document.createElement('div');
    row.className = 'move-control-row';

    var buttons = [
      ['undo-btn', 'Undo'],
      ['redo-btn', 'Redo'],
      ['reset-btn', 'Reset'],
      ['replay-prev-btn', '⟨ Replay'],
      ['replay-next-btn', 'Replay ⟩'],
      ['continue-btn', 'Continue']
    ];

    buttons.forEach(function (item) {
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'move-button';
      button.id = item[0];
      button.textContent = item[1];
      row.appendChild(button);
    });

    wrap.appendChild(row);
    el.moveHistoryPanel.insertBefore(wrap, el.moveHistoryList);

    document.getElementById('undo-btn').onclick = function () {
      var page = pageById(currentPageId);
      if (!page || !page.moves.length) {
        return;
      }
      page.redoStack.push(page.moves.pop());
      replayState[page.id] = { cursor: page.moves.length };
      refreshPage(page);
    };

    document.getElementById('redo-btn').onclick = function () {
      var page = pageById(currentPageId);
      if (!page || !page.redoStack.length) {
        return;
      }
      page.moves.push(page.redoStack.pop());
      replayState[page.id] = { cursor: page.moves.length };
      refreshPage(page);
    };

    document.getElementById('reset-btn').onclick = function () {
      var page = pageById(currentPageId);
      if (!page || !page.moves.length || !window.confirm('Clear every recorded move on this page? This cannot be undone.')) {
        return;
      }
      page.moves = [];
      page.redoStack = [];
      replayState[page.id] = { cursor: 0 };
      refreshPage(page);
    };

    document.getElementById('replay-prev-btn').onclick = function () {
      stepReplay(-1);
    };

    document.getElementById('replay-next-btn').onclick = function () {
      stepReplay(1);
    };

    document.getElementById('continue-btn').onclick = function () {
      var page = pageById(currentPageId);
      if (!page) {
        return;
      }
      replayState[page.id] = { cursor: page.moves.length };
      refreshPage(page);
    };
  }

  function stepReplay(delta) {
    var page = pageById(currentPageId);
    if (!page) return;

    replayState[page.id] = {
      cursor: Math.max(0, Math.min(page.moves.length, cursorFor(page) + delta))
    };

    refreshPage(page);
  }

  function renderContents() {
    clear(el.contentsList);

    var query = searchQuery.trim().toLowerCase();
    var visible = pagesInOrder().filter(function (page) {
      return page.title.trim() && (!query || page.title.toLowerCase().indexOf(query) !== -1);
    });

    el.contentsEmptyState.style.display = visible.length ? 'none' : '';

    visible.forEach(function (page) {
      var entry = document.createElement('div');
      entry.className = 'contents-entry';
      entry.tabIndex = 0;
      entry.setAttribute('role', 'button');

      var title = document.createElement('span');
      title.className = 'contents-entry-title';
      title.textContent = page.title;

      var number = document.createElement('span');
      number.className = 'contents-entry-page';
      number.textContent = page.pageNumber;

      entry.appendChild(title);
      entry.appendChild(number);

      entry.onclick = function () {
        openPage(page.id, 'forward');
      };

      entry.onkeydown = function (event) {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          openPage(page.id, 'forward');
        }
      };

      el.contentsList.appendChild(entry);
    });
  }

  function toggleSearch() {
    if (!searchInputEl) {
      searchInputEl = document.createElement('input');
      searchInputEl.type = 'search';
      searchInputEl.placeholder = 'Search titles…';
      searchInputEl.style.cssText = 'width:100%;margin:14px 0 0;padding:8px 10px;border:1px solid rgba(79,56,36,.25);background:rgba(255,250,237,.35);color:var(--ink);font:italic 14px Georgia,serif;outline:none;';
      searchInputEl.oninput = function () {
        searchQuery = searchInputEl.value;
        renderContents();
      };
      el.contentsList.parentNode.insertBefore(searchInputEl, el.contentsList);
    }

    searchInputEl.style.display = searchInputEl.style.display === 'none' ? 'block' : 'none';
    if (searchInputEl.style.display === 'block') {
      searchInputEl.focus();
    } else {
      searchInputEl.value = '';
      searchQuery = '';
      renderContents();
    }
  }

  function showPage(page, direction) {
    [el.contentsPage, el.notebookPage].forEach(function (item) {
      item.style.display = item === page ? 'block' : 'none';
    });

    if (direction) {
      el.book.classList.remove('is-turning-forward', 'is-turning-backward');
      void page.offsetWidth;
      el.book.classList.add(direction === 'forward' ? 'is-turning-forward' : 'is-turning-backward');
      setTimeout(function () {
        el.book.classList.remove('is-turning-forward', 'is-turning-backward');
      }, 480);
    }

    updateNavButtons();
  }

  function updateNavButtons() {
    el.previous.disabled = currentView === 'contents';
  }

  function openContents(direction) {
    currentView = 'contents';
    currentPageId = null;
    el.pageLabel.textContent = 'Contents';
    el.book.dataset.page = 'contents';
    renderContents();
    showPage(el.contentsPage, direction);
  }

  function openPage(id, direction) {
    var page = pageById(id);
    if (!page) {
      return;
    }

    currentView = 'notebook';
    currentPageId = id;
    el.book.dataset.page = 'notebook';

    el.notebookTitle.value = page.title;
    el.notes.value = page.notes;
    el.pageNumber.textContent = page.pageNumber;
    el.pageLabel.textContent = page.title || 'Page ' + page.pageNumber;

    if (!replayState[id]) {
      replayState[id] = { cursor: page.moves.length };
    }

    renderMoves(page);
    renderBoard(page);
    updateControls(page);
    showPage(el.notebookPage, direction);
  }

  function createPage(direction) {
    var page = {
      id: newPageId(),
      pageNumber: state.nextPageNumber,
      title: '',
      notes: '',
      moves: [],
      redoStack: [],
    };

    state.nextPageNumber += 1;

    state.pages.push(page);
    saveState();
    openPage(page.id, direction);
  }

  function nextPage() {
    var pages = pagesInOrder();

    if (currentView === 'contents') {
      if (pages.length) {
        openPage(pages[0].id, 'forward');
      } else {
        createPage('forward');
      }
      return;
    }

    if (currentView === 'notebook') {
      var index = pages.findIndex(function (page) {
        return page.id === currentPageId;
      });

      if (index === pages.length - 1) {
        createPage('forward');
      } else {
        openPage(pages[index + 1].id, 'forward');
      }
    }
  }

  function previousPage() {
    if (currentView !== 'notebook') {
      return;
    }

    var pages = pagesInOrder();
    var index = pages.findIndex(function (page) {
      return page.id === currentPageId;
    });

    if (index <= 0) {
      openContents('backward');
    } else {
      openPage(pages[index - 1].id, 'backward');
    }
  }

  function wireSwipe() {
    var startX = null;
    var startY = null;

    el.book.addEventListener('touchstart', function (event) {
      if (event.touches.length !== 1) {
        return;
      }
      startX = event.touches[0].clientX;
      startY = event.touches[0].clientY;
    }, { passive: true });

    el.book.addEventListener('touchend', function (event) {
      if (startX === null) {
        return;
      }

      var t = event.changedTouches[0];
      var dx = t.clientX - startX;
      var dy = t.clientY - startY;
      startX = null;
      startY = null;

      if (Math.abs(dx) < 55) return;
      if (Math.abs(dx) < Math.abs(dy) * 1.3) return;

      if (dx > 0) {
        previousPage();
      } else {
        nextPage();
      }
    }, { passive: true });
  }

  function wireTitleAndNotes() {
    el.notebookTitle.oninput = function () {
      var page = pageById(currentPageId);
      if (!page) {
        return;
      }

      page.title = el.notebookTitle.value;
      saveState();
      renderContents();
      el.pageLabel.textContent = page.title || 'Page ' + page.pageNumber;
    };

    el.notes.oninput = function () {
      var page = pageById(currentPageId);
      if (!page) {
        return;
      }

      page.notes = el.notes.value;
      saveState();
    };
  }

  function installBoard() {
    if (typeof window.Chess !== 'function' || typeof window.Chessboard !== 'function') {
      return;
    }

    board = window.Chessboard('chessboard', {
      draggable: true,
      pieceTheme: 'https://cdn.jsdelivr.net/npm/chessboardjs@1.0.0/www/img/chesspieces/wikipedia/{piece}.png',
      position: 'start',
      orientation: 'white',
      showNotation: false,
      onDragStart: function (source, piece) {
        if (currentView !== 'notebook') {
          return false;
        }

        var page = pageById(currentPageId);
        if (!page) {
          return false;
        }

        var cursor = cursorFor(page);
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

        var page = pageById(currentPageId);
        if (!page) {
          return 'snapback';
        }

        var cursor = cursorFor(page);
        if (cursor !== page.moves.length) {
          return 'snapback';
        }

        var game = gameFromMoves(page.moves);

        var move = game.move({
          from: source,
          to: target,
          promotion: 'q'
        });

        if (!move) {
          return 'snapback';
        }

        if (page.moves.length % 2 === 0) {
          page.moves.push({
            moveNumber: Math.floor(page.moves.length / 2) + 1,
            color: 'w',
            san: move.san,
            from: move.from,
            to: move.to,
            promotion: move.promotion || null,
            fen: game.fen()
          });
        } else {
          page.moves.push({
            moveNumber: Math.floor(page.moves.length / 2) + 1,
            color: 'b',
            san: move.san,
            from: move.from,
            to: move.to,
            promotion: move.promotion || null,
            fen: game.fen()
          });
        }

        page.redoStack = [];
        replayState[page.id] = { cursor: page.moves.length };
        renderMoves(page);
        renderBoard(page);
        updateControls(page);
        saveState();

        return true;
      }
    });

    if (currentPageId) {
      renderBoard(currentPageId);
    }
  }

  function wireCover() {
    el.bookCover.addEventListener('click', function () {
      el.bookCover.classList.add('hidden');
      el.bookStage.classList.remove('hidden');
      openContents(null);
    });
  }

  function wireNav() {
    el.previous.addEventListener('click', previousPage);
    el.next.addEventListener('click', nextPage);
    el.backToContents.addEventListener('click', function () {
      openContents('backward');
    });
    el.contentsSearchBtn.addEventListener('click', toggleSearch);
  }

  function init() {
    buildControls();
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
      renderBoard(currentPageId);
    }
  }

  function persistOnVisibilityChange() {
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') {
        saveState();
      }
    });

    window.addEventListener('beforeunload', saveState);
  }

  function finalizeSetup() {
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
