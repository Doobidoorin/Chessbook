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
    bookCover: document.getElementById('book-cover'), bookStage: document.getElementById('book-stage'), book: document.getElementById('book'),
    contentsPage: document.getElementById('contents-page'), contentsList: document.getElementById('contents-list'), contentsEmptyState: document.getElementById('contents-empty-state'), contentsSearchBtn: document.getElementById('contents-search'),
    notebookPage: document.getElementById('notebook-page'), notebookTitle: document.getElementById('notebook-title'), backToContents: document.getElementById('back-to-contents'),
    moveHistoryPanel: document.getElementById('move-history-panel'), moveHistoryList: document.getElementById('move-history-list'), notes: document.getElementById('notebook-notes'), pageNumber: document.getElementById('notebook-page-number'),
    previous: document.getElementById('previous-page'), next: document.getElementById('next-page'), pageLabel: document.getElementById('current-page-number')
  };

  function loadState() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      var saved = raw ? JSON.parse(raw) : null;
      if (!saved || !Array.isArray(saved.pages)) return { pages: [], nextPageNumber: 1 };
      if (typeof saved.nextPageNumber !== 'number') saved.nextPageNumber = saved.pages.length + 1;
      saved.pages.forEach(function (page) {
        page.title = typeof page.title === 'string' ? page.title : '';
        page.notes = typeof page.notes === 'string' ? page.notes : '';
        page.moves = Array.isArray(page.moves) ? page.moves : [];
        page.redoStack = Array.isArray(page.redoStack) ? page.redoStack : [];
      });
      return saved;
    } catch (error) {
      console.error('Chessbook: failed to load local notebook', error);
      return { pages: [], nextPageNumber: 1 };
    }
  }

  function saveState() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (error) { console.error('Chessbook: failed to save local notebook', error); }
  }

  function pageById(id) { return state.pages.find(function (page) { return page.id === id; }) || null; }
  function pagesInOrder() { return state.pages.slice().sort(function (a, b) { return a.pageNumber - b.pageNumber; }); }
  function newPageId() { return 'p_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8); }
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

  function gameFromMoves(moves) {
    var game = new Chess();
    (moves || []).forEach(function (entry) {
      if (!entry || !entry.from || !entry.to) return;
      try { game.move({ from: entry.from, to: entry.to, promotion: entry.promotion || 'q' }); } catch (error) { console.warn('Chessbook: skipped invalid saved move', entry, error); }
    });
    return game;
  }

  function cursorFor(page) {
    if (!replayState[page.id]) replayState[page.id] = { cursor: page.moves.length };
    return replayState[page.id].cursor;
  }

  function renderBoard(page) {
    if (!board || !page) return;
    var game = gameFromMoves(page.moves.slice(0, cursorFor(page)));
    board.position(game.fen(), false);
    window.requestAnimationFrame(function () { if (board) board.resize(); });
  }

  function renderMoves(page) {
    if (!page) return;
    var cursor = cursorFor(page);
    clear(el.moveHistoryList);
    if (!page.moves.length) {
      var empty = document.createElement('div'); empty.className = 'move-row'; empty.textContent = 'No moves recorded yet'; empty.style.opacity = '0.5'; el.moveHistoryList.appendChild(empty); return;
    }
    for (var i = 0; i < page.moves.length; i += 2) {
      var row = document.createElement('div'); row.className = 'move-row';
      if (i >= cursor) row.classList.add('dimmed');
      if (cursor > 0 && (i === cursor - 1 || i + 1 === cursor - 1)) row.classList.add('current');
      var number = document.createElement('span'); number.className = 'move-number'; number.textContent = page.moves[i].moveNumber + '.';
      var white = document.createElement('span'); white.className = 'move-white'; white.textContent = page.moves[i].color === 'w' ? page.moves[i].san : '';
      var black = document.createElement('span'); black.className = 'move-black'; black.textContent = page.moves[i + 1] && page.moves[i + 1].color === 'b' ? page.moves[i + 1].san : '';
      row.appendChild(number); row.appendChild(white); row.appendChild(black); el.moveHistoryList.appendChild(row);
    }
    if (cursor === page.moves.length) el.moveHistoryList.scrollTop = el.moveHistoryList.scrollHeight;
  }

  function updateControls(page) {
    if (!page) return;
    var cursor = cursorFor(page);
    var ids = ['undo-btn', 'redo-btn', 'reset-btn', 'replay-prev-btn', 'replay-next-btn', 'continue-btn'];
    var buttons = {}; ids.forEach(function (id) { buttons[id] = document.getElementById(id); });
    buttons['undo-btn'].disabled = page.moves.length === 0;
    buttons['redo-btn'].disabled = page.redoStack.length === 0;
    buttons['reset-btn'].disabled = page.moves.length === 0;
    buttons['replay-prev-btn'].disabled = cursor === 0;
    buttons['replay-next-btn'].disabled = cursor === page.moves.length;
    buttons['continue-btn'].style.display = cursor === page.moves.length ? 'none' : 'inline-block';
  }

  function refreshPage(page) { renderMoves(page); renderBoard(page); updateControls(page); saveState(); }

  function recordMove(source, target) {
    var page = pageById(currentPageId);
    if (!page || cursorFor(page) !== page.moves.length) return 'snapback';
    var game = gameFromMoves(page.moves);
    var move;
    try { move = game.move({ from: source, to: target, promotion: 'q' }); } catch (error) { move = null; }
    if (!move) return 'snapback';
    page.moves.push({ moveNumber: Math.floor(page.moves.length / 2) + 1, color: move.color, san: move.san, from: move.from, to: move.to, promotion: move.promotion || null, fen: game.fen() });
    page.redoStack = [];
    replayState[page.id] = { cursor: page.moves.length };
    refreshPage(page);
    return true;
  }

  function buildControls() {
    var wrap = document.createElement('div'); wrap.className = 'move-controls';
    var row = document.createElement('div'); row.className = 'move-control-row';
    [['undo-btn', 'Undo'], ['redo-btn', 'Redo'], ['reset-btn', 'Reset'], ['replay-prev-btn', '⟨ Replay'], ['replay-next-btn', 'Replay ⟩'], ['continue-btn', 'Continue']].forEach(function (item) {
      var button = document.createElement('button'); button.type = 'button'; button.className = 'move-button'; button.id = item[0]; button.textContent = item[1]; row.appendChild(button);
    });
    wrap.appendChild(row); el.moveHistoryPanel.insertBefore(wrap, el.moveHistoryList);
    document.getElementById('undo-btn').onclick = function () { var p = pageById(currentPageId); if (!p || !p.moves.length) return; p.redoStack.push(p.moves.pop()); replayState[p.id] = { cursor: p.moves.length }; refreshPage(p); };
    document.getElementById('redo-btn').onclick = function () { var p = pageById(currentPageId); if (!p || !p.redoStack.length) return; p.moves.push(p.redoStack.pop()); replayState[p.id] = { cursor: p.moves.length }; refreshPage(p); };
    document.getElementById('reset-btn').onclick = function () { var p = pageById(currentPageId); if (!p || !p.moves.length || !window.confirm('Clear every recorded move on this page? This cannot be undone.')) return; p.moves = []; p.redoStack = []; replayState[p.id] = { cursor: 0 }; refreshPage(p); };
    document.getElementById('replay-prev-btn').onclick = function () { stepReplay(-1); };
    document.getElementById('replay-next-btn').onclick = function () { stepReplay(1); };
    document.getElementById('continue-btn').onclick = function () { var p = pageById(currentPageId); if (!p) return; replayState[p.id] = { cursor: p.moves.length }; refreshPage(p); };
  }

  function stepReplay(delta) { var p = pageById(currentPageId); if (!p) return; replayState[p.id] = { cursor: Math.max(0, Math.min(p.moves.length, cursorFor(p) + delta)) }; refreshPage(p); }

  function renderContents() {
    clear(el.contentsList);
    var query = searchQuery.trim().toLowerCase();
    var visible = pagesInOrder().filter(function (p) { return p.title.trim() && (!query || p.title.toLowerCase().indexOf(query) !== -1); });
    el.contentsEmptyState.style.display = visible.length ? 'none' : '';
    visible.forEach(function (page) { var entry = document.createElement('div'); entry.className = 'contents-entry'; entry.tabIndex = 0; entry.setAttribute('role', 'button'); var title = document.createElement('span'); title.className = 'contents-entry-title'; title.textContent = page.title; var number = document.createElement('span'); number.className = 'contents-entry-page'; number.textContent = page.pageNumber; entry.appendChild(title); entry.appendChild(number); entry.onclick = function () { openPage(page.id, 'forward'); }; entry.onkeydown = function (event) { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openPage(page.id, 'forward'); } }; el.contentsList.appendChild(entry); });
  }

  function toggleSearch() {
    if (!searchInputEl) { searchInputEl = document.createElement('input'); searchInputEl.type = 'search'; searchInputEl.placeholder = 'Search titles…'; searchInputEl.style.cssText = 'width:100%;margin:14px 0 0;padding:8px 10px;border:1px solid rgba(79,56,36,.25);background:rgba(255,250,237,.35);color:var(--ink);font:italic 14px Georgia,serif;outline:none;'; searchInputEl.oninput = function () { searchQuery = searchInputEl.value; renderContents(); }; el.contentsList.parentNode.insertBefore(searchInputEl, el.contentsList); }
    searchInputEl.style.display = searchInputEl.style.display === 'none' ? 'block' : 'none'; if (searchInputEl.style.display === 'block') searchInputEl.focus(); else { searchInputEl.value = ''; searchQuery = ''; renderContents(); }
  }

  function showPage(page, direction) { [el.contentsPage, el.notebookPage].forEach(function (item) { item.style.display = item === page ? 'block' : 'none'; }); if (direction) { el.book.classList.remove('is-turning-forward', 'is-turning-backward'); void page.offsetWidth; el.book.classList.add(direction === 'forward' ? 'is-turning-forward' : 'is-turning-backward'); setTimeout(function () { el.book.classList.remove('is-turning-forward', 'is-turning-backward'); }, 480); } }
  function openContents(direction) { currentView = 'contents'; currentPageId = null; el.pageLabel.textContent = 'Contents'; el.book.dataset.page = 'contents'; renderContents(); showPage(el.contentsPage, direction); el.previous.disabled = true; }
  function openPage(id, direction) { var page = pageById(id); if (!page) return; currentView = 'notebook'; currentPageId = id; el.book.dataset.page = 'notebook'; el.notebookPage.style.display = 'block'; el.notebookTitle.value = page.title; el.notes.value = page.notes; el.pageNumber.textContent = page.pageNumber; el.pageLabel.textContent = page.title || 'Page ' + page.pageNumber; if (!replayState[id]) replayState[id] = { cursor: page.moves.length }; renderMoves(page); renderBoard(page); updateControls(page); showPage(el.notebookPage, direction); el.previous.disabled = false; if (board) window.requestAnimationFrame(function () { board.resize(); }); }
  function createPage(direction) { var page = { id: newPageId(), pageNumber: state.nextPageNumber++, title: '', notes: '', moves: [], redoStack: [] }; state.pages.push(page); saveState(); openPage(page.id, direction); }
  function nextPage() { var pages = pagesInOrder(); if (currentView === 'contents') { if (pages.length) openPage(pages[0].id, 'forward'); else createPage('forward'); return; } var index = pages.findIndex(function (p) { return p.id === currentPageId; }); if (index === pages.length - 1) createPage('forward'); else openPage(pages[index + 1].id, 'forward'); }
  function previousPage() { if (currentView !== 'notebook') return; var pages = pagesInOrder(); var index = pages.findIndex(function (p) { return p.id === currentPageId; }); if (index <= 0) openContents('backward'); else openPage(pages[index - 1].id, 'backward'); }

  function installBoard() {
    if (typeof window.Chess !== 'function' || typeof window.Chessboard !== 'function') { console.error('Chessbook: chess.js/chessboard.js failed to load.'); return; }
    board = window.Chessboard('chessboard', { draggable: true, position: 'start', orientation: 'white', showNotation: true, pieceTheme: 'https://cdn.jsdelivr.net/npm/chessboardjs@1.0.0/www/img/chesspieces/wikipedia/{piece}.png', onDragStart: function (source, piece) { var page = pageById(currentPageId); if (currentView !== 'notebook' || !page || cursorFor(page) !== page.moves.length) return false; return (page.moves.length % 2 === 0) === (piece.charAt(0) === 'w'); }, onDrop: recordMove });
  }

  function wire() {
    buildControls(); installBoard();
    el.bookCover.onclick = function () { el.bookCover.classList.add('hidden'); el.bookStage.classList.remove('hidden'); openContents(); };
    el.previous.onclick = previousPage; el.next.onclick = nextPage; el.backToContents.onclick = function () { openContents('backward'); }; el.contentsSearchBtn.onclick = toggleSearch;
    el.notebookTitle.oninput = function () { var p = pageById(currentPageId); if (!p) return; p.title = el.notebookTitle.value; el.pageLabel.textContent = p.title || 'Page ' + p.pageNumber; renderContents(); saveState(); };
    el.notes.oninput = function () { var p = pageById(currentPageId); if (!p) return; p.notes = el.notes.value; saveState(); };
    document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') saveState(); }); window.addEventListener('beforeunload', saveState);
    var startX = null; var startY = null; el.book.addEventListener('touchstart', function (event) { if (event.touches.length === 1) { startX = event.touches[0].clientX; startY = event.touches[0].clientY; } }, { passive: true }); el.book.addEventListener('touchend', function (event) { if (startX === null) return; var dx = event.changedTouches[0].clientX - startX; var dy = event.changedTouches[0].clientY - startY; startX = null; if (Math.abs(dx) >= 55 && Math.abs(dx) >= Math.abs(dy) * 1.3) dx > 0 ? previousPage() : nextPage(); }, { passive: true });
    openContents();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire); else wire();
}());
