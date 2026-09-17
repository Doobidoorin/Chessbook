/* =========================================================================
   CHESSBOOK — app.js
   Functional layer only. Visual design (index.html / style.css) is locked.
   No engine, no bot, no move suggestions — the user enters both sides.
   Persistence: localStorage for now (Supabase wiring is a separate step).
   ========================================================================= */

(function () {
  "use strict";

  /* =======================================================================
     0. INJECTED STYLES
     A few interaction states (selected square, legal-move dot, active move
     row, small controls row) have no hook in the locked stylesheet. These
     rules reuse the existing CSS custom properties so they inherit the
     current palette instead of introducing a new visual language.
     ======================================================================= */
  var injectedCSS = [
    "#chess-board-container .placeholder-board { cursor: default; }",
    "#chess-board-container .sq { display:flex; align-items:center; justify-content:center;",
    "  font-size: clamp(16px, 3.6vw, 34px); line-height:1; user-select:none; position:relative; }",
    "#chess-board-container .sq.live { cursor:pointer; }",
    "#chess-board-container .sq.sq-selected { box-shadow: inset 0 0 0 3px var(--gold); }",
    "#chess-board-container .sq.sq-target::after { content:''; position:absolute; width:26%; height:26%;",
    "  border-radius:50%; background: rgba(184,149,74,0.55); }",
    "#chess-board-container .sq.sq-target.sq-capture::after { width:100%; height:100%; border-radius:0;",
    "  background: transparent; box-shadow: inset 0 0 0 3px rgba(157,48,73,0.65); }",
    "#chess-board-container .sq.sq-lastmove { box-shadow: inset 0 0 0 3px rgba(157,48,73,0.35); }",
    ".board-controls { display:flex; align-items:center; justify-content:space-between; gap:6px;",
    "  margin-top:10px; padding-top:8px; border-top:1px solid rgba(79,56,36,0.2); }",
    ".board-controls .icon-button { width:30px; height:30px; font-size:12px; font-family:Georgia,serif; }",
    ".board-controls .icon-button:disabled { opacity:0.28; cursor:default; transform:none; background:rgba(255,250,237,0.3); }",
    ".board-controls .live-btn { width:auto; border-radius:14px; padding:0 10px; font-size:10px;",
    "  letter-spacing:0.08em; text-transform:uppercase; }",
    ".board-controls .live-btn.is-live { opacity:0.4; cursor:default; }",
    ".move-row { cursor:pointer; }",
    ".move-row.active-row { background: rgba(184,149,74,0.16); }",
    ".move-row .move-white.active-ply, .move-row .move-black.active-ply { color: var(--cover-red); font-weight:600; }",
    ".contents-entry { cursor:pointer; transition: background 120ms ease; }",
    ".contents-entry:hover { background: rgba(184,149,74,0.1); }",
    ".status-flag { margin-left:6px; font-size:11px; color: var(--muted-ink); font-style:italic; }"
  ].join("\n");

  var styleTag = document.createElement("style");
  styleTag.id = "chessbook-app-styles";
  styleTag.textContent = injectedCSS;
  document.head.appendChild(styleTag);

  /* =======================================================================
     1. CHESS ENGINE
     Plain array board, index = rank*8 + file (rank0 = rank "1", file0 = "a").
     No external library — kept self-contained so index.html stays untouched.
     ======================================================================= */

  var FILES = "abcdefgh";

  function sqName(idx) {
    return FILES[idx % 8] + String(Math.floor(idx / 8) + 1);
  }
  function fileOf(idx) { return idx % 8; }
  function rankOf(idx) { return Math.floor(idx / 8); }
  function idxOf(file, rank) {
    if (file < 0 || file > 7 || rank < 0 || rank > 7) return -1;
    return rank * 8 + file;
  }
  function colorOf(piece) {
    if (!piece) return null;
    return piece === piece.toUpperCase() ? "w" : "b";
  }
  function isOwn(piece, color) { return piece && colorOf(piece) === color; }
  function isOpponent(piece, color) { return piece && colorOf(piece) !== color; }

  function initialState() {
    var board = new Array(64).fill(null);
    var backRank = ["R", "N", "B", "Q", "K", "B", "N", "R"];
    for (var f = 0; f < 8; f++) {
      board[idxOf(f, 0)] = backRank[f];
      board[idxOf(f, 1)] = "P";
      board[idxOf(f, 6)] = "p";
      board[idxOf(f, 7)] = backRank[f].toLowerCase();
    }
    return {
      board: board,
      turn: "w",
      castling: { K: true, Q: true, k: true, q: true },
      ep: null
    };
  }

  function cloneState(s) {
    return {
      board: s.board.slice(),
      turn: s.turn,
      castling: {
        K: s.castling.K, Q: s.castling.Q,
        k: s.castling.k, q: s.castling.q
      },
      ep: s.ep
    };
  }

  var KNIGHT_OFFSETS = [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]];
  var KING_OFFSETS = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
  var BISHOP_DIRS = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
  var ROOK_DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

  function isAttacked(board, targetIdx, byColor) {
    var tf = fileOf(targetIdx), tr = rankOf(targetIdx);

    // Pawn attacks
    var pawnRankDir = byColor === "w" ? -1 : 1; // square the attacking pawn sits on, relative to target
    var pawnChar = byColor === "w" ? "P" : "p";
    for (var dc = -1; dc <= 1; dc += 2) {
      var pf = tf + dc, pr = tr + pawnRankDir;
      var pIdx = idxOf(pf, pr);
      if (pIdx !== -1 && board[pIdx] === pawnChar) return true;
    }

    // Knight attacks
    var knightChar = byColor === "w" ? "N" : "n";
    for (var i = 0; i < KNIGHT_OFFSETS.length; i++) {
      var kIdx = idxOf(tf + KNIGHT_OFFSETS[i][0], tr + KNIGHT_OFFSETS[i][1]);
      if (kIdx !== -1 && board[kIdx] === knightChar) return true;
    }

    // King adjacency
    var kingChar = byColor === "w" ? "K" : "k";
    for (var j = 0; j < KING_OFFSETS.length; j++) {
      var adjIdx = idxOf(tf + KING_OFFSETS[j][0], tr + KING_OFFSETS[j][1]);
      if (adjIdx !== -1 && board[adjIdx] === kingChar) return true;
    }

    // Sliding: bishop/queen
    var bishopChar = byColor === "w" ? "B" : "b";
    var queenChar = byColor === "w" ? "Q" : "q";
    for (var d1 = 0; d1 < BISHOP_DIRS.length; d1++) {
      var step = BISHOP_DIRS[d1];
      var f = tf + step[0], r = tr + step[1];
      while (true) {
        var idx = idxOf(f, r);
        if (idx === -1) break;
        var p = board[idx];
        if (p) {
          if (p === bishopChar || p === queenChar) return true;
          break;
        }
        f += step[0]; r += step[1];
      }
    }

    // Sliding: rook/queen
    var rookChar = byColor === "w" ? "R" : "r";
    for (var d2 = 0; d2 < ROOK_DIRS.length; d2++) {
      var step2 = ROOK_DIRS[d2];
      var f2 = tf + step2[0], r2 = tr + step2[1];
      while (true) {
        var idx2 = idxOf(f2, r2);
        if (idx2 === -1) break;
        var p2 = board[idx2];
        if (p2) {
          if (p2 === rookChar || p2 === queenChar) return true;
          break;
        }
        f2 += step2[0]; r2 += step2[1];
      }
    }

    return false;
  }

  function findKing(board, color) {
    var target = color === "w" ? "K" : "k";
    for (var i = 0; i < 64; i++) if (board[i] === target) return i;
    return -1;
  }

  function isInCheck(state, color) {
    var kingIdx = findKing(state.board, color);
    if (kingIdx === -1) return false;
    return isAttacked(state.board, kingIdx, color === "w" ? "b" : "w");
  }

  // Pseudo-legal moves for the piece on `from` (ignores own-king-safety).
  function pseudoMovesFrom(state, from) {
    var board = state.board;
    var piece = board[from];
    if (!piece) return [];
    var color = colorOf(piece);
    var type = piece.toUpperCase();
    var f = fileOf(from), r = rankOf(from);
    var moves = [];

    function push(to, opts) {
      var m = {
        from: from, to: to, piece: piece,
        captured: board[to] || null,
        isEnPassant: false, isCastle: null, promotion: null
      };
      if (opts) for (var k in opts) m[k] = opts[k];
      moves.push(m);
    }

    if (type === "P") {
      var dir = color === "w" ? 1 : -1;
      var startRank = color === "w" ? 1 : 6;
      var promoRank = color === "w" ? 7 : 0;
      var oneIdx = idxOf(f, r + dir);
      if (oneIdx !== -1 && !board[oneIdx]) {
        push(oneIdx, { isPromotion: (r + dir === promoRank) });
        if (r === startRank) {
          var twoIdx = idxOf(f, r + 2 * dir);
          if (twoIdx !== -1 && !board[twoIdx]) {
            push(twoIdx, { isDoubleStep: true });
          }
        }
      }
      for (var dc = -1; dc <= 1; dc += 2) {
        var capIdx = idxOf(f + dc, r + dir);
        if (capIdx === -1) continue;
        if (board[capIdx] && isOpponent(board[capIdx], color)) {
          push(capIdx, { isPromotion: (r + dir === promoRank) });
        } else if (state.ep !== null && capIdx === state.ep) {
          push(capIdx, { isEnPassant: true, captured: board[idxOf(f + dc, r)] });
        }
      }
    } else if (type === "N") {
      for (var i = 0; i < KNIGHT_OFFSETS.length; i++) {
        var to = idxOf(f + KNIGHT_OFFSETS[i][0], r + KNIGHT_OFFSETS[i][1]);
        if (to === -1) continue;
        if (!board[to] || isOpponent(board[to], color)) push(to);
      }
    } else if (type === "K") {
      for (var j = 0; j < KING_OFFSETS.length; j++) {
        var to2 = idxOf(f + KING_OFFSETS[j][0], r + KING_OFFSETS[j][1]);
        if (to2 === -1) continue;
        if (!board[to2] || isOpponent(board[to2], color)) push(to2);
      }
      // Castling
      var oppColor = color === "w" ? "b" : "w";
      if (!isAttacked(board, from, oppColor)) {
        if (color === "w" && from === 4) {
          if (state.castling.K && !board[5] && !board[6] && board[7] === "R" &&
              !isAttacked(board, 5, oppColor) && !isAttacked(board, 6, oppColor)) {
            push(6, { isCastle: "K" });
          }
          if (state.castling.Q && !board[3] && !board[2] && !board[1] && board[0] === "R" &&
              !isAttacked(board, 3, oppColor) && !isAttacked(board, 2, oppColor)) {
            push(2, { isCastle: "Q" });
          }
        } else if (color === "b" && from === 60) {
          if (state.castling.k && !board[61] && !board[62] && board[63] === "r" &&
              !isAttacked(board, 61, oppColor) && !isAttacked(board, 62, oppColor)) {
            push(62, { isCastle: "K" });
          }
          if (state.castling.q && !board[59] && !board[58] && !board[57] && board[56] === "r" &&
              !isAttacked(board, 59, oppColor) && !isAttacked(board, 58, oppColor)) {
            push(58, { isCastle: "Q" });
          }
        }
      }
    } else {
      var dirs = type === "B" ? BISHOP_DIRS : type === "R" ? ROOK_DIRS : BISHOP_DIRS.concat(ROOK_DIRS);
      for (var d = 0; d < dirs.length; d++) {
        var step = dirs[d];
        var nf = f + step[0], nr = r + step[1];
        while (true) {
          var ti = idxOf(nf, nr);
          if (ti === -1) break;
          if (!board[ti]) {
            push(ti);
          } else {
            if (isOpponent(board[ti], color)) push(ti);
            break;
          }
          nf += step[0]; nr += step[1];
        }
      }
    }

    return moves;
  }

  function applyMove(state, move) {
    var next = cloneState(state);
    var board = next.board;
    var piece = move.piece;
    var color = colorOf(piece);

    board[move.from] = null;
    if (move.isEnPassant) {
      var capSq = idxOf(fileOf(move.to), rankOf(move.from));
      board[capSq] = null;
    }
    board[move.to] = move.promotion
      ? (color === "w" ? move.promotion.toUpperCase() : move.promotion.toLowerCase())
      : piece;

    if (move.isCastle === "K") {
      if (color === "w") { board[7] = null; board[5] = "R"; }
      else { board[63] = null; board[61] = "r"; }
    } else if (move.isCastle === "Q") {
      if (color === "w") { board[0] = null; board[3] = "R"; }
      else { board[56] = null; board[59] = "r"; }
    }

    // Castling rights
    if (piece === "K") { next.castling.K = false; next.castling.Q = false; }
    if (piece === "k") { next.castling.k = false; next.castling.q = false; }
    if (move.from === 0 || move.to === 0) next.castling.Q = false;
    if (move.from === 7 || move.to === 7) next.castling.K = false;
    if (move.from === 56 || move.to === 56) next.castling.q = false;
    if (move.from === 63 || move.to === 63) next.castling.k = false;

    // En passant target
    next.ep = move.isDoubleStep
      ? idxOf(fileOf(move.from), (rankOf(move.from) + rankOf(move.to)) / 2)
      : null;

    next.turn = color === "w" ? "b" : "w";
    return next;
  }

  // Legal moves for one square: pseudo-legal, filtered by own-king safety.
  function legalMovesFrom(state, from) {
    var piece = state.board[from];
    if (!piece || colorOf(piece) !== state.turn) return [];
    var pseudo = pseudoMovesFrom(state, from);
    var legal = [];
    for (var i = 0; i < pseudo.length; i++) {
      var m = pseudo[i];
      var testMove = m;
      if (m.isPromotion && !m.promotion) testMove = Object.assign({}, m, { promotion: "q" });
      var after = applyMove(state, testMove);
      if (!isInCheck(after, colorOf(piece))) legal.push(m);
    }
    return legal;
  }

  function allLegalMoves(state, color) {
    var out = [];
    for (var i = 0; i < 64; i++) {
      if (state.board[i] && colorOf(state.board[i]) === color) {
        out = out.concat(legalMovesFrom(state, i));
      }
    }
    return out;
  }

  // Build SAN for a move, given the state BEFORE the move is applied.
  function toSAN(state, move) {
    if (move.isCastle === "K") return finishSAN(state, move, "O-O");
    if (move.isCastle === "Q") return finishSAN(state, move, "O-O-O");

    var piece = move.piece;
    var type = piece.toUpperCase();
    var isCapture = !!move.captured;
    var san = "";

    if (type === "P") {
      if (isCapture) san += FILES[fileOf(move.from)] + "x";
      san += sqName(move.to);
      if (move.promotion) san += "=" + move.promotion.toUpperCase();
    } else {
      san += type;
      // Disambiguation
      var siblings = allLegalMoves(state, colorOf(piece)).filter(function (m) {
        return m.piece === piece && m.to === move.to && m.from !== move.from;
      });
      if (siblings.length) {
        var sameFile = siblings.some(function (m) { return fileOf(m.from) === fileOf(move.from); });
        var sameRank = siblings.some(function (m) { return rankOf(m.from) === rankOf(move.from); });
        if (!sameFile) san += FILES[fileOf(move.from)];
        else if (!sameRank) san += String(rankOf(move.from) + 1);
        else san += sqName(move.from);
      }
      if (isCapture) san += "x";
      san += sqName(move.to);
    }
    return finishSAN(state, move, san);
  }

  function finishSAN(state, move, base) {
    var after = applyMove(state, move);
    var oppColor = after.turn;
    var inCheck = isInCheck(after, oppColor);
    var hasMoves = allLegalMoves(after, oppColor).length > 0;
    if (inCheck && !hasMoves) return base + "#";
    if (inCheck) return base + "+";
    return base;
  }

  // Replay a stored move list (each {from,to,promotion}) from the start
  // and return the resulting state. Stored moves are re-resolved against
  // legal-move generation each time, so this is always rules-consistent.
  function replayToState(moves, uptoCount) {
    var state = initialState();
    var n = typeof uptoCount === "number" ? uptoCount : moves.length;
    for (var i = 0; i < n; i++) {
      var stored = moves[i];
      var candidates = legalMovesFrom(state, stored.from);
      var match = null;
      for (var j = 0; j < candidates.length; j++) {
        if (candidates[j].to === stored.to) { match = candidates[j]; break; }
      }
      if (!match) break; // corrupted data guard — stop replay rather than throw
      if (stored.promotion) match = Object.assign({}, match, { promotion: stored.promotion });
      state = applyMove(state, match);
    }
    return state;
  }

  /* =======================================================================
     2. PERSISTENCE (localStorage — Supabase wiring comes later)
     ======================================================================= */

  var STORAGE_KEY = "chessbook_pages_v1";

  function loadPages() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      var parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      console.error("Chessbook: failed to read saved pages", e);
      return [];
    }
  }

  function savePages(pages) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(pages));
    } catch (e) {
      console.error("Chessbook: failed to save pages", e);
    }
  }

  function uid() {
    return "p_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
  }

  function newPage(pageNumber) {
    return {
      id: uid(),
      page_number: pageNumber,
      title: "",
      notes: "",
      moves: [] // [{from,to,promotion,san,color}], chronological, ply-by-ply
    };
  }

  /* =======================================================================
     3. APP STATE
     ======================================================================= */

  var app = {
    pages: loadPages(),
    currentPageId: null,   // null while on Contents
    viewingIndex: null,    // null = live (end of moves); else "viewing after move N"
    redoStack: [],         // per current page, cleared when page changes or a new move is made
    selectedSquare: null,  // board square index currently selected for a move
    searchTerm: ""
  };

  function currentPage() {
    if (!app.currentPageId) return null;
    for (var i = 0; i < app.pages.length; i++) {
      if (app.pages[i].id === app.currentPageId) return app.pages[i];
    }
    return null;
  }

  function persist() { savePages(app.pages); }

  /* =======================================================================
     4. DOM REFERENCES
     ======================================================================= */

  var el = {
    bookApp: document.getElementById("book-app"),
    bookCover: document.getElementById("book-cover"),
    bookStage: document.getElementById("book-stage"),
    book: document.getElementById("book"),

    contentsPage: document.getElementById("contents-page"),
    contentsList: document.getElementById("contents-list"),
    contentsEmpty: document.getElementById("contents-empty-state"),
    contentsSearch: document.getElementById("contents-search"),

    notebookPage: document.getElementById("notebook-page"),
    backToContents: document.getElementById("back-to-contents"),
    notebookTitle: document.getElementById("notebook-title"),
    notebookNotes: document.getElementById("notebook-notes"),
    notebookPageNumber: document.getElementById("notebook-page-number"),

    chessBoardContainer: document.getElementById("chess-board-container"),
    moveHistoryList: document.getElementById("move-history-list"),
    moveHistoryPanel: document.getElementById("move-history-panel"),

    previousPage: document.getElementById("previous-page"),
    nextPage: document.getElementById("next-page"),
    currentPageNumber: document.getElementById("current-page-number")
  };

  /* =======================================================================
     5. BOARD RENDERING (repurposes the existing .placeholder-board grid so
        the designer's checker-pattern CSS keeps applying automatically)
     ======================================================================= */

  var PIECE_GLYPHS = {
    K: "♔", Q: "♕", R: "♖", B: "♗", N: "♘", P: "♙",
    k: "♚", q: "♛", r: "♜", b: "♝", n: "♞", p: "♟"
  };

  var boardSquares = []; // 64 span elements, in visual (rank8→rank1) DOM order
  var squareIndexOrder = []; // parallel array: squareIndexOrder[domPos] = boardIdx

  function ensureBoardDOM() {
    var placeholder = el.chessBoardContainer.querySelector(".placeholder-board");
    if (!placeholder) return;
    placeholder.innerHTML = "";
    boardSquares = [];
    squareIndexOrder = [];
    for (var row = 0; row < 8; row++) {
      var rank = 7 - row;
      for (var col = 0; col < 8; col++) {
        var boardIdx = idxOf(col, rank);
        var span = document.createElement("span");
        span.className = "sq";
        span.dataset.sq = String(boardIdx);
        placeholder.appendChild(span);
        boardSquares.push(span);
        squareIndexOrder.push(boardIdx);
      }
    }
  }

  function liveState() {
    var page = currentPage();
    if (!page) return initialState();
    return replayToState(page.moves, page.moves.length);
  }

  function displayedState() {
    var page = currentPage();
    if (!page) return initialState();
    var count = app.viewingIndex === null ? page.moves.length : app.viewingIndex;
    return replayToState(page.moves, count);
  }

  function renderBoard() {
    if (!boardSquares.length) ensureBoardDOM();
    var page = currentPage();
    var state = displayedState();
    var isLive = app.viewingIndex === null;

    var lastMoveFrom = null, lastMoveTo = null;
    if (page && page.moves.length) {
      var count = app.viewingIndex === null ? page.moves.length : app.viewingIndex;
      if (count > 0) {
        var last = page.moves[count - 1];
        lastMoveFrom = last.from;
        lastMoveTo = last.to;
      }
    }

    var legalTargets = [];
    if (app.selectedSquare !== null && isLive) {
      legalTargets = legalMovesFrom(state, app.selectedSquare);
    }

    for (var i = 0; i < boardSquares.length; i++) {
      var span = boardSquares[i];
      var boardIdx = squareIndexOrder[i];
      var piece = state.board[boardIdx];
      span.textContent = piece ? PIECE_GLYPHS[piece] : "";
      span.classList.toggle("live", isLive);
      span.classList.toggle("sq-selected", app.selectedSquare === boardIdx);
      span.classList.toggle("sq-lastmove", boardIdx === lastMoveFrom || boardIdx === lastMoveTo);

      var target = null;
      for (var t = 0; t < legalTargets.length; t++) {
        if (legalTargets[t].to === boardIdx) { target = legalTargets[t]; break; }
      }
      span.classList.toggle("sq-target", !!target);
      span.classList.toggle("sq-capture", !!(target && target.captured));
    }
  }

  function onSquareClick(boardIdx) {
    var page = currentPage();
    if (!page || app.viewingIndex !== null) return; // read-only while viewing history

    var state = liveState();

    if (app.selectedSquare === null) {
      var piece = state.board[boardIdx];
      if (piece && colorOf(piece) === state.turn) {
        app.selectedSquare = boardIdx;
        renderBoard();
      }
      return;
    }

    if (app.selectedSquare === boardIdx) {
      app.selectedSquare = null;
      renderBoard();
      return;
    }

    var candidates = legalMovesFrom(state, app.selectedSquare);
    var chosen = null;
    for (var i = 0; i < candidates.length; i++) {
      if (candidates[i].to === boardIdx) { chosen = candidates[i]; break; }
    }

    if (!chosen) {
      // Clicking another own piece re-selects instead of illegal-move no-op
      var maybeOwn = state.board[boardIdx];
      if (maybeOwn && colorOf(maybeOwn) === state.turn) {
        app.selectedSquare = boardIdx;
        renderBoard();
      }
      return;
    }

    if (chosen.isPromotion) {
      var choice = promptPromotion();
      if (!choice) { app.selectedSquare = null; renderBoard(); return; }
      chosen = Object.assign({}, chosen, { promotion: choice });
    }

    commitMove(state, chosen);
  }

  function promptPromotion() {
    var input = window.prompt("Promote pawn to (Q, R, B, or N):", "Q");
    if (!input) return null;
    var letter = input.trim().toLowerCase().charAt(0);
    if (["q", "r", "b", "n"].indexOf(letter) === -1) return "q";
    return letter;
  }

  function commitMove(state, move) {
    var page = currentPage();
    if (!page) return;
    var san = toSAN(state, move);
    page.moves.push({
      from: move.from,
      to: move.to,
      promotion: move.promotion || null,
      san: san,
      color: state.turn
    });
    app.redoStack = [];
    app.selectedSquare = null;
    app.viewingIndex = null;
    persist();
    renderNotebookPage();
  }

  /* =======================================================================
     6. MOVE HISTORY RENDERING
     ======================================================================= */

  function renderMoveHistory() {
    var page = currentPage();
    el.moveHistoryList.innerHTML = "";
    if (!page) return;

    var displayedCount = app.viewingIndex === null ? page.moves.length : app.viewingIndex;

    for (var i = 0; i < page.moves.length; i += 2) {
      var moveNumber = Math.floor(i / 2) + 1;
      var whiteMove = page.moves[i];
      var blackMove = page.moves[i + 1];

      var row = document.createElement("div");
      row.className = "move-row";

      var numEl = document.createElement("span");
      numEl.className = "move-number";
      numEl.textContent = moveNumber + ".";

      var whiteEl = document.createElement("span");
      whiteEl.className = "move-white";
      whiteEl.textContent = whiteMove ? whiteMove.san : "";
      if (i + 1 === displayedCount || (i === displayedCount - 1 && !blackMove)) {
        // active ply handled below explicitly
      }

      var blackEl = document.createElement("span");
      blackEl.className = "move-black";
      blackEl.textContent = blackMove ? blackMove.san : "";

      row.appendChild(numEl);
      row.appendChild(whiteEl);
      row.appendChild(blackEl);

      if (whiteMove && i + 1 === displayedCount) {
        row.classList.add("active-row");
        whiteEl.classList.add("active-ply");
      }
      if (blackMove && i + 2 === displayedCount) {
        row.classList.add("active-row");
        blackEl.classList.add("active-ply");
      }

      (function (afterCount) {
        row.addEventListener("click", function () {
          app.viewingIndex = (afterCount === page.moves.length) ? null : afterCount;
          app.selectedSquare = null;
          renderBoard();
          renderMoveHistory();
          updateLiveButtonState();
        });
      })(blackMove ? i + 2 : i + 1);

      el.moveHistoryList.appendChild(row);
    }

    el.moveHistoryList.scrollTop = el.moveHistoryList.scrollHeight;
  }

  /* =======================================================================
     7. BOARD CONTROLS (Undo / Redo / Reset / Return-to-current)
     Injected once into the move-history panel, since the locked design has
     no existing element for them.
     ======================================================================= */

  var controls = {};

  function ensureControlsDOM() {
    if (document.getElementById("board-controls")) return;
    var row = document.createElement("div");
    row.className = "board-controls";
    row.id = "board-controls";

    var left = document.createElement("div");
    left.style.display = "flex";
    left.style.gap = "6px";

    controls.undo = document.createElement("button");
    controls.undo.type = "button";
    controls.undo.className = "icon-button";
    controls.undo.title = "Undo last move";
    controls.undo.textContent = "\u21B6"; // ↶

    controls.redo = document.createElement("button");
    controls.redo.type = "button";
    controls.redo.className = "icon-button";
    controls.redo.title = "Redo move";
    controls.redo.textContent = "\u21B7"; // ↷

    controls.reset = document.createElement("button");
    controls.reset.type = "button";
    controls.reset.className = "icon-button";
    controls.reset.title = "Reset this page's game";
    controls.reset.textContent = "\u27F2"; // ⟲

    left.appendChild(controls.undo);
    left.appendChild(controls.redo);
    left.appendChild(controls.reset);

    controls.live = document.createElement("button");
    controls.live.type = "button";
    controls.live.className = "icon-button live-btn";
    controls.live.textContent = "Live";
    controls.live.title = "Return to current position";

    row.appendChild(left);
    row.appendChild(controls.live);

    el.moveHistoryPanel.appendChild(row);

    controls.undo.addEventListener("click", handleUndo);
    controls.redo.addEventListener("click", handleRedo);
    controls.reset.addEventListener("click", handleReset);
    controls.live.addEventListener("click", function () {
      app.viewingIndex = null;
      app.selectedSquare = null;
      renderBoard();
      renderMoveHistory();
      updateLiveButtonState();
    });
  }

  function handleUndo() {
    var page = currentPage();
    if (!page || app.viewingIndex !== null || !page.moves.length) return;
    var removed = page.moves.pop();
    app.redoStack.push(removed);
    app.selectedSquare = null;
    persist();
    renderBoard();
    renderMoveHistory();
    updateControlsState();
  }

  function handleRedo() {
    var page = currentPage();
    if (!page || app.viewingIndex !== null || !app.redoStack.length) return;
    var restored = app.redoStack.pop();
    page.moves.push(restored);
    app.selectedSquare = null;
    persist();
    renderBoard();
    renderMoveHistory();
    updateControlsState();
  }

  function handleReset() {
    var page = currentPage();
    if (!page) return;
    if (!page.moves.length) return;
    var ok = window.confirm("Reset this page's entire game? This cannot be undone.");
    if (!ok) return;
    page.moves = [];
    app.redoStack = [];
    app.selectedSquare = null;
    app.viewingIndex = null;
    persist();
    renderBoard();
    renderMoveHistory();
    updateControlsState();
  }

  function updateControlsState() {
    var page = currentPage();
    var live = app.viewingIndex === null;
    controls.undo.disabled = !page || !live || !page.moves.length;
    controls.redo.disabled = !live || !app.redoStack.length;
    controls.reset.disabled = !page || !page.moves.length;
    updateLiveButtonState();
  }

  function updateLiveButtonState() {
    var isLive = app.viewingIndex === null;
    controls.live.classList.toggle("is-live", isLive);
  }

  /* =======================================================================
     8. NOTEBOOK PAGE RENDERING
     ======================================================================= */

  function renderNotebookPage() {
    var page = currentPage();
    if (!page) return;

    el.notebookTitle.value = page.title || "";
    el.notebookNotes.value = page.notes || "";
    el.notebookPageNumber.textContent = String(page.page_number);
    el.currentPageNumber.textContent = "Page " + page.page_number;

    app.selectedSquare = null;
    if (app.viewingIndex !== null && app.viewingIndex > page.moves.length) {
      app.viewingIndex = null;
    }

    renderBoard();
    renderMoveHistory();
    updateControlsState();
  }

  /* =======================================================================
     9. CONTENTS RENDERING
     ======================================================================= */

  function renderContents() {
    var titled = app.pages.filter(function (p) { return p.title && p.title.trim().length; });

    var filtered = titled;
    if (app.searchTerm) {
      var term = app.searchTerm.toLowerCase();
      filtered = titled.filter(function (p) { return p.title.toLowerCase().indexOf(term) !== -1; });
    }

    el.contentsList.innerHTML = "";
    filtered
      .slice()
      .sort(function (a, b) { return a.page_number - b.page_number; })
      .forEach(function (page) {
        var entry = document.createElement("div");
        entry.className = "contents-entry";

        var titleEl = document.createElement("span");
        titleEl.className = "contents-entry-title";
        titleEl.textContent = page.title;

        var pageEl = document.createElement("span");
        pageEl.className = "contents-entry-page";
        pageEl.textContent = String(page.page_number);

        entry.appendChild(titleEl);
        entry.appendChild(pageEl);

        entry.addEventListener("click", function () {
          openPage(page.id);
        });

        el.contentsList.appendChild(entry);
      });

    var showEmpty = titled.length === 0;
    el.contentsEmpty.classList.toggle("hidden", !showEmpty);
    el.contentsList.classList.toggle("hidden", showEmpty && !app.searchTerm);
  }

  /* =======================================================================
     10. SCREEN / PAGE NAVIGATION
     ======================================================================= */

  function showContentsScreen(animateDir) {
    app.currentPageId = null;
    app.viewingIndex = null;
    app.selectedSquare = null;
    el.book.dataset.page = "contents";

    el.notebookPage.style.display = "none";
    el.contentsPage.classList.remove("hidden");

    if (animateDir) animatePageTurn(el.contentsPage, animateDir);

    el.currentPageNumber.textContent = "Contents";
    el.previousPage.disabled = true;

    renderContents();
  }

  function openPage(pageId, animateDir) {
    var page = null;
    for (var i = 0; i < app.pages.length; i++) {
      if (app.pages[i].id === pageId) { page = app.pages[i]; break; }
    }
    if (!page) return;

    app.currentPageId = page.id;
    app.redoStack = [];
    el.book.dataset.page = "notebook";

    el.contentsPage.classList.add("hidden");
    el.notebookPage.style.display = "block";

    if (animateDir) animatePageTurn(el.notebookPage, animateDir);

    el.previousPage.disabled = false;

    renderNotebookPage();
  }

  function animatePageTurn(pageEl, dir) {
    el.book.classList.remove("is-turning-forward", "is-turning-backward");
    pageEl.classList.remove("page-enter-forward", "page-enter-backward");
    void pageEl.offsetWidth; // restart animation
    if (dir === "forward") {
      el.book.classList.add("is-turning-forward");
      pageEl.classList.add("page-enter-forward");
    } else {
      el.book.classList.add("is-turning-backward");
      pageEl.classList.add("page-enter-backward");
    }
    window.setTimeout(function () {
      el.book.classList.remove("is-turning-forward", "is-turning-backward");
      pageEl.classList.remove("page-enter-forward", "page-enter-backward");
    }, 480);
  }

  function goNext() {
    var page = currentPage();
    if (!page) {
      // From Contents: open page 1, creating it if the notebook is empty.
      var first = app.pages.slice().sort(function (a, b) { return a.page_number - b.page_number; })[0];
      if (!first) {
        first = newPage(1);
        app.pages.push(first);
        persist();
      }
      openPage(first.id, "forward");
      return;
    }
    var sorted = app.pages.slice().sort(function (a, b) { return a.page_number - b.page_number; });
    var idx = sorted.findIndex(function (p) { return p.id === page.id; });
    if (idx === sorted.length - 1) {
      var created = newPage(page.page_number + 1);
      app.pages.push(created);
      persist();
      openPage(created.id, "forward");
    } else {
      openPage(sorted[idx + 1].id, "forward");
    }
  }

  function goPrevious() {
    var page = currentPage();
    if (!page) return; // already on Contents
    var sorted = app.pages.slice().sort(function (a, b) { return a.page_number - b.page_number; });
    var idx = sorted.findIndex(function (p) { return p.id === page.id; });
    if (idx <= 0) {
      showContentsScreen("backward");
    } else {
      openPage(sorted[idx - 1].id, "backward");
    }
  }

  /* =======================================================================
     11. FIELD BINDINGS (title / notes)
     ======================================================================= */

  function bindTitleAndNotes() {
    el.notebookTitle.addEventListener("input", function () {
      var page = currentPage();
      if (!page) return;
      page.title = el.notebookTitle.value;
      persist();
      renderContents();
    });

    el.notebookNotes.addEventListener("input", function () {
      var page = currentPage();
      if (!page) return;
      page.notes = el.notebookNotes.value;
      persist();
    });
  }

  /* =======================================================================
     12. EVENT WIRING
     ======================================================================= */

  function bindCover() {
    el.bookCover.addEventListener("click", function () {
      el.bookCover.classList.add("hidden");
      el.bookStage.classList.remove("hidden");
      showContentsScreen();
    });
  }

  function bindNav() {
    el.nextPage.addEventListener("click", goNext);
    el.previousPage.addEventListener("click", goPrevious);
    el.backToContents.addEventListener("click", function () {
      showContentsScreen("backward");
    });
  }

  function bindSearch() {
    el.contentsSearch.addEventListener("click", function () {
      var term = window.prompt("Search page titles:", app.searchTerm || "");
      app.searchTerm = (term || "").trim();
      renderContents();
    });
  }

  function bindBoard() {
    el.chessBoardContainer.addEventListener("click", function (evt) {
      var target = evt.target.closest(".sq");
      if (!target) return;
      onSquareClick(parseInt(target.dataset.sq, 10));
    });
  }

  function bindSwipe() {
    var touchStartX = null, touchStartY = null;
    var THRESHOLD = 50;

    el.book.addEventListener("touchstart", function (evt) {
      if (evt.touches.length !== 1) return;
      touchStartX = evt.touches[0].clientX;
      touchStartY = evt.touches[0].clientY;
    }, { passive: true });

    el.book.addEventListener("touchend", function (evt) {
      if (touchStartX === null) return;
      var touch = evt.changedTouches[0];
      var dx = touch.clientX - touchStartX;
      var dy = touch.clientY - touchStartY;
      touchStartX = null; touchStartY = null;

      if (Math.abs(dx) < THRESHOLD || Math.abs(dx) < Math.abs(dy)) return;

      if (dx > 0) {
        goPrevious(); // left-to-right swipe -> previous page
      } else {
        goNext(); // right-to-left swipe -> next page
      }
    }, { passive: true });
  }

  /* =======================================================================
     13. INIT
     ======================================================================= */

  function init() {
    ensureBoardDOM();
    ensureControlsDOM();
    bindCover();
    bindNav();
    bindSearch();
    bindBoard();
    bindSwipe();
    bindTitleAndNotes();

    el.previousPage.disabled = true;
    renderContents();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();i
