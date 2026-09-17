"use strict";
const SUPABASE_URL = "YOUR_SUPABASE_URL";
const SUPABASE_PUBLISHABLE_KEY = "YOUR_SUPABASE_PUBLISHABLE_KEY";
const AUTH_EMAIL_DOMAIN = "chessbook.local";

const WORDS_PER_PAGE = 80;

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);


const state = {
  session: null,
  entries: [], 
  book: [], 
  slotIndex: 0, 
  chess: {
    game: null,
    sanMoves: [], 
    currentPly: 0,
    selectedSquare: null,
    legalTargets: [],
  },
};

let saveTimer = null;

const el = {
  cover: document.getElementById("cover"),
  book: document.getElementById("book"),
  stage: document.getElementById("stage"),
  pageCurrent: document.getElementById("pageCurrent"),
  pageBehind: document.getElementById("pageBehind"),
  edgePrev: document.getElementById("edgePrev"),
  edgeNext: document.getElementById("edgeNext"),
  authModal: document.getElementById("authModal"),
  authTitle: document.getElementById("authTitle"),
  authUsername: document.getElementById("authUsername"),
  authPassword: document.getElementById("authPassword"),
  authError: document.getElementById("authError"),
  authSubmit: document.getElementById("authSubmit"),
  authToggle: document.getElementById("authToggle"),
};

let authMode = "signin";

function usernameToEmail(username) {
  return `${username.trim().toLowerCase().replace(/[^a-z0-9_.-]/g, "")}@${AUTH_EMAIL_DOMAIN}`;
}

function openAuth() {
  el.authModal.classList.remove("hidden");
  el.authError.textContent = "";
}

function closeAuth() {
  el.authModal.classList.add("hidden");
}

el.authToggle.addEventListener("click", () => {
  authMode = authMode === "signin" ? "signup" : "signin";
  el.authTitle.textContent = authMode === "signin" ? "Sign in" : "Create your Chessbook";
  el.authSubmit.textContent = authMode === "signin" ? "Sign in" : "Create account";
  el.authToggle.textContent = authMode === "signin" ? "Need an account? Create one" : "Already have an account? Sign in";
  el.authError.textContent = "";
});

el.authSubmit.addEventListener("click", async () => {
  const username = el.authUsername.value.trim();
  const password = el.authPassword.value;
  if (!username || !password) {
    el.authError.textContent = "Enter a username and password.";
    return;
  }
  const email = usernameToEmail(username);
  el.authSubmit.disabled = true;
  try {
    if (authMode === "signin") {
      const { data, error } = await sb.auth.signInWithPassword({ email, password });
      if (error) throw error;
      state.session = data.session;
    } else {
      const { data, error } = await sb.auth.signUp({
        email,
        password,
        options: { data: { username } },
      });
      if (error) throw error;
      state.session = data.session;
    }
    closeAuth();
    await enterBook();
  } catch (err) {
    el.authError.textContent = humanizeAuthError(err);
  } finally {
    el.authSubmit.disabled = false;
  }
});

function humanizeAuthError(err) {
  const msg = (err && err.message) || "Something went wrong.";
  if (/already registered|already exists/i.test(msg)) return "That username is taken.";
  if (/invalid login credentials/i.test(msg)) return "Wrong username or password.";
  return msg;
}

el.cover.addEventListener("click", async () => {
  const { data } = await sb.auth.getSession();
  state.session = data.session;
  if (!state.session) {
    openAuth();
    return;
  }
  await enterBook();
});

async function enterBook() {
  el.cover.classList.add("cover-open");
  await loadEntries();
  state.slotIndex = 0; 
  setTimeout(() => {
    el.cover.classList.add("hidden");
    el.book.classList.remove("hidden");
    renderCurrentSlot();
  }, 500);
}

async function loadEntries() {
  const { data, error } = await sb
    .from("notebook_pages")
    .select("*")
    .order("page_number", { ascending: true });
  if (error) {
    console.error(error);
    state.entries = [];
  } else {
    state.entries = (data || []).filter((r) => r.title && r.title.trim().length > 0);
  }
  state.book = buildBook(state.entries);
}

function paginateNotes(text, wordsPerPage) {
  const words = (text || "").trim().length ? text.trim().split(/\s+/) : [];
  if (words.length === 0) return [""];
  const pages = [];
  for (let i = 0; i < words.length; i += wordsPerPage) {
    pages.push(words.slice(i, i + wordsPerPage).join(" "));
  }
  return pages;
}

function buildBook(entries) {
  const slots = [{ type: "contents" }];
  for (let idx = 0; idx < entries.length; idx++) {
    const entry = entries[idx];
    slots.push({ type: "entry", entry });

    const notesPages = paginateNotes(entry.notes, WORDS_PER_PAGE);
    let contCount = notesPages.length - 1;
    const nextEntry = entries[idx + 1];
    let capped = false;
    if (nextEntry) {
      const maxAllowed = Math.max(0, nextEntry.page_number - entry.page_number - 1);
      if (contCount > maxAllowed) {
        contCount = maxAllowed;
        capped = true;
      }
    }
    for (let c = 1; c <= contCount; c++) {
      const isLast = c === contCount;
      const text = isLast && capped ? notesPages.slice(c).join(" ") : notesPages[c];
      slots.push({
        type: "continuation",
        entry,
        pageNumber: entry.page_number + c,
        text,
      });
    }
  }
  const last = entries[entries.length - 1];
  let newPageNumber = 1;
  if (last) {
    const notesPages = paginateNotes(last.notes, WORDS_PER_PAGE);
    newPageNumber = last.page_number + notesPages.length; 
  }
  slots.push({ type: "new", pageNumber: newPageNumber });
  return slots;
}

function parseMoves(movesField) {
  if (!movesField) return [];
  if (Array.isArray(movesField)) return movesField;
  try {
    const parsed = JSON.parse(movesField);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    return [];
  }
}

function gameAtPly(sanMoves, ply) {
  const game = new Chess();
  for (let i = 0; i < ply; i++) {
    game.move(sanMoves[i]);
  }
  return game;
}

function renderCurrentSlot() {
  const slot = state.book[state.slotIndex];
  el.pageCurrent.innerHTML = "";
  el.pageCurrent.classList.remove("page-contents");
  if (!slot) return;

  if (slot.type === "contents") {
    el.pageCurrent.classList.add("page-contents");
    renderContentsPage(el.pageCurrent);
  } else if (slot.type === "entry") {
    renderEntryPage(el.pageCurrent, slot.entry);
  } else if (slot.type === "continuation") {
    renderContinuationPage(el.pageCurrent, slot);
  } else if (slot.type === "new") {
    renderNewPage(el.pageCurrent, slot);
  }

  updateEdgeVisibility();
}

function updateEdgeVisibility() {
  el.edgePrev.classList.toggle("edge-disabled", state.slotIndex <= 0);
  el.edgeNext.classList.toggle("edge-disabled", false); 
}

function renderContentsPage(container) {
  const wrap = document.createElement("div");
  wrap.className = "contents-page";

  const header = document.createElement("div");
  header.className = "contents-header";
  const title = document.createElement("div");
  title.className = "contents-title";
  title.textContent = "𝓒𝓸𝓷𝓽𝓮𝓷𝓽𝓼";
  const searchBtn = document.createElement("button");
  searchBtn.className = "search-btn";
  searchBtn.setAttribute("aria-label", "Search");
  searchBtn.innerHTML = "&#128269;";
  header.appendChild(title);
  header.appendChild(searchBtn);
  wrap.appendChild(header);

  const searchBar = document.createElement("div");
  searchBar.className = "search-bar hidden";
  const searchInput = document.createElement("input");
  searchInput.type = "text";
  searchInput.placeholder = "Search titles and notes";
  searchBar.appendChild(searchInput);
  wrap.appendChild(searchBar);

  const list = document.createElement("div");
  list.className = "contents-list";
  wrap.appendChild(list);

  function renderList(items) {
    list.innerHTML = "";
    if (items.length === 0) {
      const empty = document.createElement("div");
      empty.className = "contents-empty";
      empty.textContent = searchInput.value ? "No matches." : "";
      list.appendChild(empty);
      return;
    }
    items.forEach((entry) => {
      const row = document.createElement("div");
      row.className = "contents-row";
      const t = document.createElement("span");
      t.className = "contents-row-title";
      t.textContent = entry.title;
      const p = document.createElement("span");
      p.className = "contents-row-page";
      p.textContent = entry.page_number;
      row.appendChild(t);
      row.appendChild(p);
      row.addEventListener("click", () => {
        const idx = state.book.findIndex((s) => s.type === "entry" && s.entry.id === entry.id);
        if (idx >= 0) {
          state.slotIndex = idx;
          renderCurrentSlot();
        }
      });
      list.appendChild(row);
    });
  }

  renderList(state.entries.slice().sort((a, b) => a.page_number - b.page_number));

  searchBtn.addEventListener("click", () => {
    searchBar.classList.toggle("hidden");
    if (!searchBar.classList.contains("hidden")) searchInput.focus();
  });

  searchInput.addEventListener("input", () => {
    const q = searchInput.value.trim().toLowerCase();
    if (!q) {
      renderList(state.entries.slice().sort((a, b) => a.page_number - b.page_number));
      return;
    }
    const matches = state.entries.filter(
      (e) => (e.title || "").toLowerCase().includes(q) || (e.notes || "").toLowerCase().includes(q)
    );
    renderList(matches.sort((a, b) => a.page_number - b.page_number));
  });

  container.appendChild(wrap);
}

function renderEntryPage(container, entry) {
  const wrap = document.createElement("div");
  wrap.className = "entry-page";


  const titleInput = document.createElement("input");
  titleInput.type = "text";
  titleInput.className = "entry-title no-drag";
  titleInput.value = entry.title || "";
  titleInput.placeholder = "Untitled";
  titleInput.addEventListener("input", () => {
    entry.title = titleInput.value;
    queueSave(entry, { title: entry.title });
  });
  wrap.appendChild(titleInput);

  // Board
  const sanMoves = parseMoves(entry.moves);
  state.chess.sanMoves = sanMoves.slice();
  state.chess.currentPly = sanMoves.length;
  state.chess.selectedSquare = null;
  state.chess.legalTargets = [];
  state.chess.game = gameAtPly(state.chess.sanMoves, state.chess.currentPly);

  const boardWrap = document.createElement("div");
  boardWrap.className = "board-wrap no-drag";
  const boardEl = document.createElement("div");
  boardEl.className = "chessboard";
  boardWrap.appendChild(boardEl);
  wrap.appendChild(boardWrap);

  // Move nav
  const nav = document.createElement("div");
  nav.className = "move-nav no-drag";
  const backBtn = document.createElement("button");
  backBtn.className = "nav-btn";
  backBtn.textContent = "\u2190";
  const fwdBtn = document.createElement("button");
  fwdBtn.className = "nav-btn";
  fwdBtn.textContent = "\u2192";
  const plyLabel = document.createElement("span");
  plyLabel.className = "ply-label";
  nav.appendChild(backBtn);
  nav.appendChild(plyLabel);
  nav.appendChild(fwdBtn);
  wrap.appendChild(nav);

  function refreshBoard() {
    drawBoard(boardEl, state.chess.game, onSquareClick);
    plyLabel.textContent = formatMoveList(state.chess.sanMoves, state.chess.currentPly);
    backBtn.disabled = state.chess.currentPly <= 0;
    fwdBtn.disabled = state.chess.currentPly >= state.chess.sanMoves.length;
  }

  backBtn.addEventListener("click", () => {
    if (state.chess.currentPly > 0) {
      state.chess.currentPly--;
      state.chess.game = gameAtPly(state.chess.sanMoves, state.chess.currentPly);
      state.chess.selectedSquare = null;
      state.chess.legalTargets = [];
      refreshBoard();
    }
  });

  fwdBtn.addEventListener("click", () => {
    if (state.chess.currentPly < state.chess.sanMoves.length) {
      state.chess.currentPly++;
      state.chess.game = gameAtPly(state.chess.sanMoves, state.chess.currentPly);
      state.chess.selectedSquare = null;
      state.chess.legalTargets = [];
      refreshBoard();
    }
  });

  function onSquareClick(square) {
    const game = state.chess.game;
    const piece = game.get(square);

    if (state.chess.selectedSquare) {
      if (state.chess.legalTargets.includes(square)) {
        attemptMove(state.chess.selectedSquare, square);
        return;
      }
      if (piece && piece.color === game.turn()) {
        selectSquare(square);
        return;
      }
      state.chess.selectedSquare = null;
      state.chess.legalTargets = [];
      refreshBoard();
      return;
    }

    if (piece && piece.color === game.turn()) {
      selectSquare(square);
    }
  }

  function selectSquare(square) {
    state.chess.selectedSquare = square;
    const moves = state.chess.game.moves({ square, verbose: true });
    state.chess.legalTargets = moves.map((m) => m.to);
    refreshBoard();
  }

  function attemptMove(from, to) {
    const game = state.chess.game;
    const piece = game.get(from);
    let promotion;
    if (piece && piece.type === "p" && (to[1] === "8" || to[1] === "1")) {
      promotion = askPromotion(piece.color);
    }
    const moveResult = game.move({ from, to, promotion: promotion || "q" });
    if (!moveResult) return;

  
    state.chess.sanMoves = state.chess.sanMoves.slice(0, state.chess.currentPly);
    state.chess.sanMoves.push(moveResult.san);
    state.chess.currentPly = state.chess.sanMoves.length;

    state.chess.selectedSquare = null;
    state.chess.legalTargets = [];
    refreshBoard();

    entry.moves = JSON.stringify(state.chess.sanMoves);
    entry.position = game.fen();
    queueSave(entry, { moves: entry.moves, position: entry.position });
  }

  refreshBoard();


  const notesArea = document.createElement("textarea");
  notesArea.className = "notes-area no-drag";
  notesArea.placeholder = "Notes...";
  notesArea.value = entry.notes || "";
  notesArea.addEventListener("input", () => {
    entry.notes = notesArea.value;
    queueSave(entry, { notes: entry.notes });

    state.book = buildBook(state.entries);
  });
  wrap.appendChild(notesArea);


  const pageNum = document.createElement("div");
  pageNum.className = "page-number";
  pageNum.textContent = entry.page_number;
  wrap.appendChild(pageNum);

  container.appendChild(wrap);
}

function askPromotion(color) {
  const choice = window.prompt("Promote to (q, r, b, n):", "q");
  const valid = ["q", "r", "b", "n"];
  return valid.includes((choice || "").toLowerCase()) ? choice.toLowerCase() : "q";
}

function formatMoveList(sanMoves, uptoPly) {
  let out = "";
  for (let i = 0; i < uptoPly; i++) {
    if (i % 2 === 0) out += `${i / 2 + 1}. `;
    out += sanMoves[i] + " ";
  }
  return out.trim() || "\u2014";
}

function renderContinuationPage(container, slot) {
  const wrap = document.createElement("div");
  wrap.className = "continuation-page";

  const text = document.createElement("div");
  text.className = "continuation-text";
  text.textContent = slot.text || "";
  wrap.appendChild(text);

  const pageNum = document.createElement("div");
  pageNum.className = "page-number";
  pageNum.textContent = slot.pageNumber;
  wrap.appendChild(pageNum);

  container.appendChild(wrap);
}

function renderNewPage(container, slot) {
  const wrap = document.createElement("div");
  wrap.className = "new-page";

  const prompt = document.createElement("div");
  prompt.className = "new-page-prompt";
  prompt.textContent = "Name this entry";
  wrap.appendChild(prompt);

  const titleInput = document.createElement("input");
  titleInput.type = "text";
  titleInput.className = "entry-title no-drag";
  titleInput.placeholder = "Untitled";
  wrap.appendChild(titleInput);

  const pageNum = document.createElement("div");
  pageNum.className = "page-number";
  pageNum.textContent = slot.pageNumber;
  wrap.appendChild(pageNum);

  container.appendChild(wrap);

  async function commit() {
    const title = titleInput.value.trim();
    if (!title) return;
    titleInput.disabled = true;
    const { data, error } = await sb
      .from("notebook_pages")
      .insert({
        user_id: state.session.user.id,
        page_number: slot.pageNumber,
        title,
        notes: "",
        moves: JSON.stringify([]),
        position: new Chess().fen(),
      })
      .select()
      .single();
    if (error) {
      console.error(error);
      titleInput.disabled = false;
      return;
    }
    state.entries.push(data);
    state.entries.sort((a, b) => a.page_number - b.page_number);
    state.book = buildBook(state.entries);
    const idx = state.book.findIndex((s) => s.type === "entry" && s.entry.id === data.id);
    state.slotIndex = idx >= 0 ? idx : state.slotIndex;
    renderCurrentSlot();
  }

  titleInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      titleInput.blur();
    }
  });
  titleInput.addEventListener("blur", commit);
}

const PIECE_GLYPH = {
  wp: "\u2659", wn: "\u2658", wb: "\u2657", wr: "\u2656", wq: "\u2655", wk: "\u2654",
  bp: "\u265F", bn: "\u265E", bb: "\u265D", br: "\u265C", bq: "\u265B", bk: "\u265A",
};

function drawBoard(boardEl, game, onSquareClick) {
  boardEl.innerHTML = "";
  const board = game.board(); 
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const file = "abcdefgh"[col];
      const rank = 8 - row;
      const square = `${file}${rank}`;
      const sq = document.createElement("div");
      sq.className = "square " + ((row + col) % 2 === 0 ? "square-light" : "square-dark");
      sq.dataset.square = square;

      if (square === state.chess.selectedSquare) sq.classList.add("square-selected");
      if (state.chess.legalTargets.includes(square)) sq.classList.add("square-target");

      const piece = board[row][col];
      if (piece) {
        const glyph = document.createElement("span");
        glyph.className = "piece";
        glyph.textContent = PIECE_GLYPH[piece.color + piece.type];
        sq.appendChild(glyph);
      }

      sq.addEventListener("click", () => onSquareClick(square));
      boardEl.appendChild(sq);
    }
  }
}


function queueSave(entry, patch) {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    const { error } = await sb.from("notebook_pages").update(patch).eq("id", entry.id);
    if (error) console.error("Save failed", error);
  }, 500);
}

let drag = null;

function startDrag(clientX, target) {
  if (target.closest(".no-drag")) return;
  drag = { startX: clientX, dx: 0, width: el.stage.getBoundingClientRect().width };
  el.pageCurrent.classList.add("dragging");
}

function moveDrag(clientX) {
  if (!drag) return;
  drag.dx = clientX - drag.startX;
  const forward = drag.dx < 0;
  if (forward && !hasNextAvailable()) {
    drag.dx = Math.max(drag.dx, -40);
  }
  if (!forward && state.slotIndex <= 0) {
    drag.dx = Math.min(drag.dx, 40);
  }
  const pct = Math.max(-1, Math.min(1, drag.dx / drag.width));
  el.pageCurrent.style.transform = `translateX(${drag.dx}px) rotateY(${pct * -18}deg)`;
  el.pageCurrent.style.boxShadow = `0 0 ${Math.abs(pct) * 40}px rgba(0,0,0,${Math.abs(pct) * 0.5})`;
}

function endDrag() {
  if (!drag) return;
  const width = drag.width;
  const dx = drag.dx;
  const threshold = width * 0.22;
  el.pageCurrent.classList.remove("dragging");

  if (dx <= -threshold && hasNextAvailable()) {
    turnPage(1);
  } else if (dx >= threshold && state.slotIndex > 0) {
    turnPage(-1);
  } else {
    el.pageCurrent.style.transform = "";
    el.pageCurrent.style.boxShadow = "";
  }
  drag = null;
}

function hasNextAvailable() {
  return true; 
}

function turnPage(direction) {
  el.pageCurrent.classList.add("turning");
  el.pageCurrent.style.transform = `translateX(${direction * -100}%) rotateY(${direction * -30}deg)`;
  el.pageCurrent.style.opacity = "0.4";
  setTimeout(() => {
    state.slotIndex = Math.max(0, state.slotIndex + direction);
    el.pageCurrent.classList.remove("turning");
    el.pageCurrent.style.transform = "";
    el.pageCurrent.style.opacity = "";
    el.pageCurrent.style.boxShadow = "";
    renderCurrentSlot();
  }, 260);
}

el.stage.addEventListener("pointerdown", (e) => {
  startDrag(e.clientX, e.target);
});
el.stage.addEventListener("pointermove", (e) => {
  if (drag) moveDrag(e.clientX);
});
window.addEventListener("pointerup", () => {
  if (drag) endDrag();
});
window.addEventListener("pointercancel", () => {
  if (drag) endDrag();
});

el.edgePrev.addEventListener("click", () => {
  if (state.slotIndex > 0) turnPage(-1);
});
el.edgeNext.addEventListener("click", () => {
  turnPage(1);
});

(async function init() {
  const { data } = await sb.auth.getSession();
  state.session = data.session;
})();
