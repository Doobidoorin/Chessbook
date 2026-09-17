"use strict";

/*
  ============================================================
  CHESSBOOK
  Plain browser JavaScript
  No import
  No export
  No build system required
  ============================================================
*/


/* ============================================================
   1. SUPABASE CONFIGURATION
============================================================ */

/*
  IMPORTANT:

  Put your EXISTING Supabase project values here.

  Never put your Supabase service-role key here.

  The publishable/anon key is the frontend key intended
  for this type of application.
*/

const SUPABASE_URL = "YOUR_EXISTING_SUPABASE_URL";
const SUPABASE_PUBLISHABLE_KEY = "YOUR_EXISTING_SUPABASE_PUBLISHABLE_KEY";

const AUTH_EMAIL_DOMAIN = "chessbook.local";

const WORDS_PER_PAGE = 80;


/* ============================================================
   2. GLOBAL STATE
============================================================ */

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
    legalTargets: []
  }

};

let saveTimers = new Map();

let drag = null;

let isTurning = false;


/* ============================================================
   3. START APPLICATION AFTER DOM EXISTS
============================================================ */

document.addEventListener("DOMContentLoaded", () => {

  init();

});


/* ============================================================
   4. DOM REFERENCES
============================================================ */

function getElements() {

  return {

    cover: document.getElementById("cover"),

    book: document.getElementById("book"),

    stage: document.getElementById("stage"),

    pageCurrent: document.getElementById("pageCurrent"),

    pageBehind: document.getElementById("pageBehind"),

    edgePrev: document.getElementById("edgePrev"),

    edgeNext: document.getElementById("edgeNext"),

    authModal: document.getElementById("authModal"),

    authClose: document.getElementById("authClose"),

    authTitle: document.getElementById("authTitle"),

    authDescription: document.getElementById("authDescription"),

    authUsername: document.getElementById("authUsername"),

    authPassword: document.getElementById("authPassword"),

    authError: document.getElementById("authError"),

    authSubmit: document.getElementById("authSubmit"),

    authToggle: document.getElementById("authToggle")

  };

}


let el = null;

let authMode = "signin";


/* ============================================================
   5. INITIALIZATION
============================================================ */

async function init() {

  el = getElements();

  if (!el.cover || !el.book || !el.stage || !el.pageCurrent) {

    console.error("Chessbook could not find the required page elements.");

    return;

  }


  /*
    Make sure Supabase loaded.
  */

  if (!window.supabase || typeof window.supabase.createClient !== "function") {

    console.error("Supabase library failed to load.");

    return;

  }


  /*
    Make sure Chess.js loaded.
  */

  if (typeof window.Chess !== "function") {

    console.error("Chess.js failed to load.");

    return;

  }


  setupSupabase();

  setupAuth();

  setupCover();

  setupPageTurning();

  await restoreSession();

}


/* ============================================================
   6. SUPABASE
============================================================ */

let sb = null;


function setupSupabase() {

  if (
    !SUPABASE_URL ||
    !SUPABASE_PUBLISHABLE_KEY ||
    SUPABASE_URL.includes("YOUR_EXISTING") ||
    SUPABASE_PUBLISHABLE_KEY.includes("YOUR_EXISTING")
  ) {

    console.warn(
      "Chessbook Supabase configuration still contains placeholders."
    );

    return;

  }


  try {

    sb = window.supabase.createClient(
      SUPABASE_URL,
      SUPABASE_PUBLISHABLE_KEY
    );

  } catch (error) {

    console.error("Could not initialize Supabase:", error);

  }

}


/* ============================================================
   7. SESSION
============================================================ */

async function restoreSession() {

  if (!sb) {
    return;
  }

  try {

    const result = await sb.auth.getSession();

    if (result.error) {
      console.error(result.error);
      return;
    }

    state.session = result.data.session;

  } catch (error) {

    console.error("Session restore failed:", error);

  }

}


/* ============================================================
   8. AUTHENTICATION
============================================================ */

function setupAuth() {

  el.authToggle.addEventListener("click", toggleAuthMode);

  el.authSubmit.addEventListener("click", submitAuth);

  el.authClose.addEventListener("click", closeAuth);


  el.authUsername.addEventListener("keydown", (event) => {

    if (event.key === "Enter") {

      el.authPassword.focus();

    }

  });


  el.authPassword.addEventListener("keydown", (event) => {

    if (event.key === "Enter") {

      submitAuth();

    }

  });

}


function usernameToEmail(username) {

  const cleaned = username
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.-]/g, "");

  return `${cleaned}@${AUTH_EMAIL_DOMAIN}`;

}


function openAuth() {

  el.authModal.classList.remove("hidden");

  el.authError.textContent = "";

  setTimeout(() => {

    el.authUsername.focus();

  }, 50);

}


function closeAuth() {

  el.authModal.classList.add("hidden");

  el.authError.textContent = "";

}


function toggleAuthMode() {

  if (authMode === "signin") {

    authMode = "signup";

    el.authTitle.textContent = "Create your Chessbook";

    el.authDescription.textContent =
      "Create an account to save your notebook.";

    el.authSubmit.textContent = "Create account";

    el.authToggle.textContent =
      "Already have an account? Sign in";

  } else {

    authMode = "signin";

    el.authTitle.textContent = "Sign in";

    el.authDescription.textContent =
      "Sign in to continue to your notebook.";

    el.authSubmit.textContent = "Sign in";

    el.authToggle.textContent =
      "Need an account? Create one";

  }

  el.authError.textContent = "";

}


async function submitAuth() {

  if (!sb) {

    el.authError.textContent =
      "Supabase is not configured yet.";

    return;

  }


  const username = el.authUsername.value.trim();

  const password = el.authPassword.value;


  if (!username || !password) {

    el.authError.textContent =
      "Enter a username and password.";

    return;

  }


  const email = usernameToEmail(username);


  if (!email || email === `@${AUTH_EMAIL_DOMAIN}`) {

    el.authError.textContent =
      "Enter a valid username.";

    return;

  }


  el.authSubmit.disabled = true;

  el.authError.textContent = "";


  try {

    if (authMode === "signin") {

      const result = await sb.auth.signInWithPassword({

        email,
        password

      });


      if (result.error) {
        throw result.error;
      }


      state.session = result.data.session;


    } else {

      const result = await sb.auth.signUp({

        email,
        password,

        options: {

          data: {
            username
          }

        }

      });


      if (result.error) {
        throw result.error;
      }


      state.session = result.data.session;


      /*
        Confirm-email is expected to be disabled in the
        existing project as previously configured.
      */

      if (!state.session) {

        el.authError.textContent =
          "Account created. Sign in to continue.";

        authMode = "signin";

        el.authTitle.textContent = "Sign in";

        el.authDescription.textContent =
          "Sign in to continue to your notebook.";

        el.authSubmit.textContent = "Sign in";

        el.authToggle.textContent =
          "Need an account? Create one";

        return;

      }

    }


    closeAuth();

    await openBook();


  } catch (error) {

    console.error(error);

    el.authError.textContent =
      humanizeAuthError(error);

  } finally {

    el.authSubmit.disabled = false;

  }

}


function humanizeAuthError(error) {

  const message =
    error && error.message
      ? error.message
      : "Something went wrong.";


  if (/invalid login credentials/i.test(message)) {

    return "Wrong username or password.";

  }


  if (
    /already registered/i.test(message) ||
    /already exists/i.test(message)
  ) {

    return "That username is already taken.";

  }


  if (/password should be at least/i.test(message)) {

    return message;

  }


  return message;

}


/* ============================================================
   9. COVER
============================================================ */

function setupCover() {

  el.cover.addEventListener("click", async () => {

    /*
      If already signed in, immediately open.
    */

    if (state.session) {

      await openBook();

      return;

    }


    /*
      Check current session one more time.
    */

    if (sb) {

      try {

        const result = await sb.auth.getSession();

        state.session = result.data.session;

      } catch (error) {

        console.error(error);

      }

    }


    if (state.session) {

      await openBook();

    } else {

      /*
        Open authentication.
      */

      openAuth();

    }

  });

}


/* ============================================================
   10. OPEN BOOK
============================================================ */

async function openBook() {

  if (isTurning) {
    return;
  }


  if (!state.session) {

    openAuth();

    return;

  }


  /*
    Load notebook data before displaying Contents.
  */

  await loadEntries();


  /*
    Always begin at Contents.
  */

  state.slotIndex = 0;


  /*
    Prepare the book.
  */

  renderCurrentSlot();


  el.book.classList.remove("hidden");


  /*
    Allow the browser to paint the book first.
  */

  requestAnimationFrame(() => {

    requestAnimationFrame(() => {

      el.cover.classList.add("cover-opening");

    });

  });


  /*
    Completely remove the cover after animation.
  */

  setTimeout(() => {

    el.cover.classList.add("hidden");

  }, 750);

}


/* ============================================================
   11. LOAD NOTEBOOK ENTRIES
============================================================ */

async function loadEntries() {

  if (!sb || !state.session) {

    state.entries = [];

    state.book = buildBook([]);

    return;

  }


  try {

    const result = await sb
      .from("notebook_pages")
      .select("*")
      .eq("user_id", state.session.user.id)
      .order("page_number", {
        ascending: true
      });


    if (result.error) {

      console.error("Could not load notebook pages:", result.error);

      state.entries = [];

    } else {

      state.entries = (result.data || [])
        .filter((row) => {

          return (
            typeof row.title === "string" &&
            row.title.trim().length > 0
          );

        });

    }

  } catch (error) {

    console.error("Notebook loading failed:", error);

    state.entries = [];

  }


  state.book = buildBook(state.entries);

}


/* ============================================================
   12. PAGINATION
============================================================ */

function paginateNotes(text, wordsPerPage) {

  const cleanText = (text || "").trim();


  if (!cleanText) {

    return [""];

  }


  const words = cleanText.split(/\s+/);

  const pages = [];


  for (
    let index = 0;
    index < words.length;
    index += wordsPerPage
  ) {

    pages.push(
      words
        .slice(index, index + wordsPerPage)
        .join(" ")
    );

  }


  return pages;

}


/* ============================================================
   13. BUILD PHYSICAL BOOK
============================================================ */

function buildBook(entries) {

  const slots = [

    {
      type: "contents"
    }

  ];


  for (let index = 0; index < entries.length; index++) {

    const entry = entries[index];


    /*
      Main chess page.
    */

    slots.push({

      type: "entry",

      entry

    });


    /*
      Notes continuation.
    */

    const notePages =
      paginateNotes(
        entry.notes,
        WORDS_PER_PAGE
      );


    for (
      let pageIndex = 1;
      pageIndex < notePages.length;
      pageIndex++
    ) {

      slots.push({

        type: "continuation",

        entry,

        pageNumber:
          Number(entry.page_number) + pageIndex,

        text:
          notePages[pageIndex]

      });

    }

  }


  /*
    New entry page.

    For an empty notebook this becomes the page after
    Contents.

    For an existing notebook it appears after the last
    physical entry and its continuation pages.
  */

  let newPageNumber = 1;


  if (entries.length > 0) {

    const lastEntry =
      entries[entries.length - 1];


    const notePages =
      paginateNotes(
        lastEntry.notes,
        WORDS_PER_PAGE
      );


    newPageNumber =
      Number(lastEntry.page_number) +
      notePages.length;

  }


  slots.push({

    type: "new",

    pageNumber: newPageNumber

  });


  return slots;

}


/* ============================================================
   14. RENDER CURRENT PAGE
============================================================ */

function renderCurrentSlot() {

  const slot =
    state.book[state.slotIndex];


  if (!slot) {
    return;
  }


  el.pageCurrent.innerHTML = "";

  el.pageCurrent.className =
    "page-leaf page-current";


  if (slot.type === "contents") {

    el.pageCurrent.classList.add("page-contents");

    renderContentsPage(
      el.pageCurrent
    );

  }


  else if (slot.type === "entry") {

    renderEntryPage(
      el.pageCurrent,
      slot.entry
    );

  }


  else if (slot.type === "continuation") {

    renderContinuationPage(
      el.pageCurrent,
      slot
    );

  }


  else if (slot.type === "new") {

    renderNewPage(
      el.pageCurrent,
      slot
    );

  }


  renderBehindPage();

}


/* ============================================================
   15. RENDER PAGE BEHIND CURRENT PAGE
============================================================ */

function renderBehindPage() {

  const nextIndex =
    state.slotIndex + 1;


  const previousIndex =
    state.slotIndex - 1;


  /*
    During a forward turn, the page behind should be the
    next page.

    During a backward turn, the same area is refreshed
    when needed.
  */

  const nextSlot =
    state.book[nextIndex];


  el.pageBehind.innerHTML = "";

  el.pageBehind.className =
    "page-leaf page-behind";


  if (!nextSlot) {
    return;
  }


  if (nextSlot.type === "contents") {

    el.pageBehind.classList.add("page-contents");

    renderContentsPage(
      el.pageBehind,
      true
    );

  }


  else if (nextSlot.type === "entry") {

    renderEntryPage(
      el.pageBehind,
      nextSlot.entry,
      true
    );

  }


  else if (nextSlot.type === "continuation") {

    renderContinuationPage(
      el.pageBehind,
      nextSlot,
      true
    );

  }


  else if (nextSlot.type === "new") {

    renderNewPage(
      el.pageBehind,
      nextSlot,
      true
    );

  }

}


/* ============================================================
   16. CONTENTS PAGE
============================================================ */

function renderContentsPage(container, preview = false) {

  const wrap =
    document.createElement("div");

  wrap.className =
    "contents-page";


  const header =
    document.createElement("div");

  header.className =
    "contents-header";


  const title =
    document.createElement("div");

  title.className =
    "contents-title";

  title.textContent =
    "𝓒𝓸𝓷𝓽𝓮𝓷𝓽𝓼";


  const searchButton =
    document.createElement("button");

  searchButton.type = "button";

  searchButton.className =
    "search-btn";

  searchButton.setAttribute(
    "aria-label",
    "Search"
  );

  searchButton.textContent = "⌕";


  header.appendChild(title);

  header.appendChild(searchButton);

  wrap.appendChild(header);


  /*
    Search.
  */

  const searchBar =
    document.createElement("div");

  searchBar.className =
    "search-bar hidden";


  const searchInput =
    document.createElement("input");

  searchInput.type = "text";

  searchInput.placeholder =
    "Search titles and notes";

  searchInput.autocomplete =
    "off";


  searchBar.appendChild(searchInput);

  wrap.appendChild(searchBar);


  /*
    Contents list.
  */

  const list =
    document.createElement("div");

  list.className =
    "contents-list";


  wrap.appendChild(list);


  function getEntries() {

    return state.entries
      .slice()
      .sort(
        (a, b) =>
          Number(a.page_number) -
          Number(b.page_number)
      );

  }


  function renderList(items) {

    list.innerHTML = "";


    if (items.length === 0) {

      const empty =
        document.createElement("div");

      empty.className =
        "contents-empty";


      empty.textContent =
        searchInput.value.trim()
          ? "No matches."
          : "Your notebook is empty.";


      list.appendChild(empty);

      return;

    }


    items.forEach((entry) => {

      const row =
        document.createElement("div");

      row.className =
        "contents-row";


      const entryTitle =
        document.createElement("span");

      entryTitle.className =
        "contents-row-title";

      entryTitle.textContent =
        entry.title;


      const pageNumber =
        document.createElement("span");

      pageNumber.className =
        "contents-row-page";

      pageNumber.textContent =
        entry.page_number;


      row.appendChild(entryTitle);

      row.appendChild(pageNumber);


      if (!preview) {

        row.addEventListener(
          "click",
          () => {

            const targetIndex =
              state.book.findIndex(
                (slot) =>
                  slot.type === "entry" &&
                  slot.entry.id === entry.id
              );


            if (targetIndex < 0) {
              return;
            }


            state.slotIndex =
              targetIndex;


            renderCurrentSlot();

          }
        );

      }


      list.appendChild(row);

    });

  }


  renderList(getEntries());


  if (!preview) {

    searchButton.addEventListener(
      "click",
      () => {

        searchBar.classList.toggle(
          "hidden"
        );


        if (
          !searchBar.classList.contains(
            "hidden"
          )
        ) {

          searchInput.focus();

        }

      }
    );


    searchInput.addEventListener(
      "input",
      () => {

        const query =
          searchInput.value
            .trim()
            .toLowerCase();


        if (!query) {

          renderList(
            getEntries()
          );

          return;

        }


        const matches =
          state.entries.filter(
            (entry) => {

              const title =
                (
                  entry.title || ""
                ).toLowerCase();


              const notes =
                (
                  entry.notes || ""
                ).toLowerCase();


              return (
                title.includes(query) ||
                notes.includes(query)
              );

            }
          );


        renderList(
          matches.sort(
            (a, b) =>
              Number(a.page_number) -
              Number(b.page_number)
          )
        );

      }
    );

  }


  container.appendChild(wrap);

}


/* ============================================================
   17. ENTRY PAGE
============================================================ */

function renderEntryPage(
  container,
  entry,
  preview = false
) {

  const wrap =
    document.createElement("div");

  wrap.className =
    "entry-page";


  /*
    Title.
  */

  const titleInput =
    document.createElement("input");

  titleInput.type = "text";

  titleInput.className =
    "entry-title no-drag";

  titleInput.value =
    entry.title || "";

  titleInput.placeholder =
    "Untitled";


  if (preview) {

    titleInput.readOnly = true;

  } else {

    titleInput.addEventListener(
      "input",
      () => {

        entry.title =
          titleInput.value;

        queueSave(
          entry,
          {
            title: entry.title
          }
        );

      }
    );

  }


  wrap.appendChild(titleInput);


  /*
    Chess state.
  */

  const sanMoves =
    parseMoves(entry.moves);


  state.chess.sanMoves =
    sanMoves.slice();


  state.chess.currentPly =
    sanMoves.length;


  state.chess.selectedSquare =
    null;


  state.chess.legalTargets =
    [];


  state.chess.game =
    gameAtPly(
      state.chess.sanMoves,
      state.chess.currentPly
    );


  /*
    Board.
  */

  const boardWrap =
    document.createElement("div");

  boardWrap.className =
    "board-wrap no-drag";


  const board =
    document.createElement("div");

  board.className =
    "chessboard";


  boardWrap.appendChild(board);

  wrap.appendChild(boardWrap);


  /*
    Move navigation.
  */

  const nav =
    document.createElement("div");

  nav.className =
    "move-nav no-drag";


  const backButton =
    document.createElement("button");

  backButton.type = "button";

  backButton.className =
    "nav-btn";

  backButton.textContent =
    "←";


  const label =
    document.createElement("span");

  label.className =
    "ply-label";


  const forwardButton =
    document.createElement("button");

  forwardButton.type = "button";

  forwardButton.className =
    "nav-btn";

  forwardButton.textContent =
    "→";


  nav.appendChild(backButton);

  nav.appendChild(label);

  nav.appendChild(forwardButton);

  wrap.appendChild(nav);


  function refreshBoard() {

    drawBoard(
      board,
      state.chess.game,
      onSquareClick
    );


    label.textContent =
      formatMoveList(
        state.chess.sanMoves,
        state.chess.currentPly
      );


    backButton.disabled =
      state.chess.currentPly <= 0;


    forwardButton.disabled =
      state.chess.currentPly >=
      state.chess.sanMoves.length;

  }


  if (!preview) {

    backButton.addEventListener(
      "click",
      () => {

        if (
          state.chess.currentPly <= 0
        ) {
          return;
        }


        state.chess.currentPly--;


        state.chess.game =
          gameAtPly(
            state.chess.sanMoves,
            state.chess.currentPly
          );


        state.chess.selectedSquare =
          null;


        state.chess.legalTargets =
          [];


        refreshBoard();

      }
    );


    forwardButton.addEventListener(
      "click",
      () => {

        if (
          state.chess.currentPly >=
          state.chess.sanMoves.length
        ) {
          return;
        }


        state.chess.currentPly++;


        state.chess.game =
          gameAtPly(
            state.chess.sanMoves,
            state.chess.currentPly
          );


        state.chess.selectedSquare =
          null;


        state.chess.legalTargets =
          [];


        refreshBoard();

      }
    );

  }


  function onSquareClick(square) {

    if (preview) {
      return;
    }


    const game =
      state.chess.game;


    if (!game) {
      return;
    }


    const piece =
      game.get(square);


    if (state.chess.selectedSquare) {

      if (
        state.chess.legalTargets.includes(
          square
        )
      ) {

        attemptMove(
          state.chess.selectedSquare,
          square
        );

        return;

      }


      if (
        piece &&
        piece.color === game.turn()
      ) {

        selectSquare(square);

        return;

      }


      state.chess.selectedSquare =
        null;

      state.chess.legalTargets =
        [];


      refreshBoard();

      return;

    }


    if (
      piece &&
      piece.color === game.turn()
    ) {

      selectSquare(square);

    }

  }


  function selectSquare(square) {

    state.chess.selectedSquare =
      square;


    const moves =
      state.chess.game.moves({
        square,
        verbose: true
      });


    state.chess.legalTargets =
      moves.map(
        (move) => move.to
      );


    refreshBoard();

  }


  function attemptMove(from, to) {

    const game =
      state.chess.game;


    const piece =
      game.get(from);


    let promotion =
      "q";


    if (
      piece &&
      piece.type === "p" &&
      (to[1] === "8" ||
       to[1] === "1")
    ) {

      promotion =
        askPromotion();

    }


    const result =
      game.move({
        from,
        to,
        promotion
      });


    if (!result) {
      return;
    }


    /*
      If the user went backward and makes
      a different move, discard the old future.
    */

    state.chess.sanMoves =
      state.chess.sanMoves.slice(
        0,
        state.chess.currentPly
      );


    state.chess.sanMoves.push(
      result.san
    );


    state.chess.currentPly =
      state.chess.sanMoves.length;


    state.chess.selectedSquare =
      null;


    state.chess.legalTargets =
      [];


    refreshBoard();


    entry.moves =
      JSON.stringify(
        state.chess.sanMoves
      );


    entry.position =
      game.fen();


    queueSave(
      entry,
      {
        moves: entry.moves,
        position: entry.position
      }
    );

  }


  refreshBoard();


  /*
    Notes.
  */

  const notes =
    document.createElement("textarea");

  notes.className =
    "notes-area no-drag";

  notes.placeholder =
    "Notes...";

  notes.value =
    entry.notes || "";


  if (preview) {

    notes.readOnly = true;

  } else {

    notes.addEventListener(
      "input",
      () => {

        entry.notes =
          notes.value;


        queueSave(
          entry,
          {
            notes: entry.notes
          }
        );


        /*
          Rebuild continuation pages.
        */

        state.book =
          buildBook(
            state.entries
          );

      }
    );

  }


  wrap.appendChild(notes);


  /*
    Page number.
  */

  const pageNumber =
    document.createElement("div");

  pageNumber.className =
    "page-number";

  pageNumber.textContent =
    entry.page_number;


  wrap.appendChild(pageNumber);


  container.appendChild(wrap);

}


/* ============================================================
   18. PROMOTION
============================================================ */

function askPromotion() {

  const answer =
    window.prompt(
      "Promote to: q, r, b, or n",
      "q"
    );


  const valid = [
    "q",
    "r",
    "b",
    "n"
  ];


  const choice =
    (answer || "q")
      .trim()
      .toLowerCase();


  return valid.includes(choice)
    ? choice
    : "q";

}


/* ============================================================
   19. MOVE LIST
============================================================ */

function formatMoveList(
  sanMoves,
  uptoPly
) {

  if (!uptoPly) {

    return "Start position";

  }


  const output = [];


  for (
    let index = 0;
    index < uptoPly;
    index++
  ) {

    if (index % 2 === 0) {

      output.push(
        `${Math.floor(index / 2) + 1}.`
      );

    }


    output.push(
      sanMoves[index]
    );

  }


  return output.join(" ");

}


/* ============================================================
   20. CONTINUATION PAGE
============================================================ */

function renderContinuationPage(
  container,
  slot,
  preview = false
) {

  const wrap =
    document.createElement("div");

  wrap.className =
    "continuation-page";


  const text =
    document.createElement("div");

  text.className =
    "continuation-text";

  text.textContent =
    slot.text || "";


  wrap.appendChild(text);


  const pageNumber =
    document.createElement("div");

  pageNumber.className =
    "page-number";

  pageNumber.textContent =
    slot.pageNumber;


  wrap.appendChild(pageNumber);


  container.appendChild(wrap);

}


/* ============================================================
   21. NEW ENTRY PAGE
============================================================ */

function renderNewPage(
  container,
  slot,
  preview = false
) {

  const wrap =
    document.createElement("div");

  wrap.className =
    "new-page";


  const prompt =
    document.createElement("div");

  prompt.className =
    "new-page-prompt";

  prompt.textContent =
    "Name this entry";


  wrap.appendChild(prompt);


  const titleInput =
    document.createElement("input");

  titleInput.type = "text";

  titleInput.className =
    "entry-title no-drag";

  titleInput.placeholder =
    "Untitled";


  wrap.appendChild(titleInput);


  const pageNumber =
    document.createElement("div");

  pageNumber.className =
    "page-number";

  pageNumber.textContent =
    slot.pageNumber;


  wrap.appendChild(pageNumber);


  if (!preview) {

    let committed = false;


    async function commit() {

      if (committed) {
        return;
      }


      const title =
        titleInput.value.trim();


      if (!title) {
        return;
      }


      if (!sb || !state.session) {

        return;

      }


      committed = true;

      titleInput.disabled = true;


      try {

        const result =
          await sb
            .from("notebook_pages")
            .insert({

              user_id:
                state.session.user.id,

              page_number:
                slot.pageNumber,

              title,

              notes: "",

              moves:
                JSON.stringify([]),

              position:
                new Chess().fen()

            })
            .select()
            .single();


        if (result.error) {

          throw result.error;

        }


        state.entries.push(
          result.data
        );


        state.entries.sort(
          (a, b) =>
            Number(a.page_number) -
            Number(b.page_number)
        );


        state.book =
          buildBook(
            state.entries
          );


        const newIndex =
          state.book.findIndex(
            (bookSlot) =>
              bookSlot.type === "entry" &&
              bookSlot.entry.id ===
                result.data.id
          );


        if (newIndex >= 0) {

          state.slotIndex =
            newIndex;

        }


        renderCurrentSlot();


      } catch (error) {

        console.error(
          "Could not create entry:",
          error
        );


        committed = false;

        titleInput.disabled =
          false;

      }

    }


    titleInput.addEventListener(
      "keydown",
      (event) => {

        if (event.key === "Enter") {

          event.preventDefault();

          titleInput.blur();

        }

      }
    );


    titleInput.addEventListener(
      "blur",
      commit
    );

  }


  container.appendChild(wrap);

}


/* ============================================================
   22. CHESS
============================================================ */

function parseMoves(moves) {

  if (!moves) {
    return [];
  }


  if (Array.isArray(moves)) {
    return moves;
  }


  try {

    const parsed =
      JSON.parse(moves);


    return Array.isArray(parsed)
      ? parsed
      : [];

  } catch (error) {

    console.warn(
      "Could not parse saved chess moves.",
      error
    );


    return [];

  }

}


/* ============================================================
   23. GAME AT SPECIFIC PLY
============================================================ */

function gameAtPly(
  sanMoves,
  ply
) {

  const game =
    new window.Chess();


  for (
    let index = 0;
    index < ply;
    index++
  ) {

    try {

      game.move(
        sanMoves[index]
      );

    } catch (error) {

      console.warn(
        "Invalid saved move:",
        sanMoves[index],
        error
      );

      break;

    }

  }


  return game;

}


/* ============================================================
   24. DRAW BOARD
============================================================ */

const PIECE_GLYPH = {

  wp: "♙",
  wn: "♘",
  wb: "♗",
  wr: "♖",
  wq: "♕",
  wk: "♔",

  bp: "♟",
  bn: "♞",
  bb: "♝",
  br: "♜",
  bq: "♛",
  bk: "♚"

};


function drawBoard(
  boardElement,
  game,
  clickHandler
) {

  boardElement.innerHTML = "";


  const board =
    game.board();


  for (
    let row = 0;
    row < 8;
    row++
  ) {

    for (
      let col = 0;
      col < 8;
      col++
    ) {

      const file =
        "abcdefgh"[col];


      const rank =
        8 - row;


      const squareName =
        `${file}${rank}`;


      const square =
        document.createElement("div");


      square.className =
        "square " +
        (
          (row + col) % 2 === 0
            ? "square-light"
            : "square-dark"
        );


      square.dataset.square =
        squareName;


      if (
        squareName ===
        state.chess.selectedSquare
      ) {

        square.classList.add(
          "square-selected"
        );

      }


      if (
        state.chess.legalTargets.includes(
          squareName
        )
      ) {

        square.classList.add(
          "square-target"
        );

      }


      const piece =
        board[row][col];


      if (piece) {

        const pieceElement =
          document.createElement("span");


        pieceElement.className =
          "piece";


        pieceElement.textContent =
          PIECE_GLYPH[
            piece.color +
            piece.type
          ];


        square.appendChild(
          pieceElement
        );

      }


      square.addEventListener(
        "click",
        () => {

          clickHandler(
            squareName
          );

        }
      );


      boardElement.appendChild(
        square
      );

    }

  }

}


/* ============================================================
   25. SAVE
============================================================ */

function queueSave(
  entry,
  patch
) {

  if (!sb || !state.session) {
    return;
  }


  const entryId =
    entry.id;


  if (saveTimers.has(entryId)) {

    clearTimeout(
      saveTimers.get(entryId)
    );

  }


  const timer =
    setTimeout(
      async () => {

        try {

          const result =
            await sb
              .from("notebook_pages")
              .update(patch)
              .eq("id", entryId)
              .eq(
                "user_id",
                state.session.user.id
              );


          if (result.error) {

            console.error(
              "Save failed:",
              result.error
            );

          }

        } catch (error) {

          console.error(
            "Save request failed:",
            error
          );

        }


        saveTimers.delete(
          entryId
        );

      },
      500
    );


  saveTimers.set(
    entryId,
    timer
  );

}


/* ============================================================
   26. PAGE TURNING
============================================================ */

function setupPageTurning() {

  /*
    Mouse / touch / pointer drag.
  */

  el.stage.addEventListener(
    "pointerdown",
    (event) => {

      if (isTurning) {
        return;
      }


      const target =
        event.target;


      /*
        Do not start a page drag when interacting
        with inputs, the chessboard, buttons, notes,
        or other interactive content.
      */

      if (
        target.closest(".no-drag") ||
        target.closest("button") ||
        target.closest("input") ||
        target.closest("textarea")
      ) {

        return;

      }


      drag = {

        startX:
          event.clientX,

        currentX:
          event.clientX,

        width:
          el.stage.getBoundingClientRect()
            .width

      };


      try {

        el.stage.setPointerCapture(
          event.pointerId
        );

      } catch (error) {
        /* Pointer capture is optional. */
      }


      el.pageCurrent.classList.add(
        "dragging"
      );

    }
  );


  el.stage.addEventListener(
    "pointermove",
    (event) => {

      if (!drag) {
        return;
      }


      drag.currentX =
        event.clientX;


      updateDrag();

    }
  );


  el.stage.addEventListener(
    "pointerup",
    (event) => {

      if (!drag) {
        return;
      }


      try {

        el.stage.releasePointerCapture(
          event.pointerId
        );

      } catch (error) {
        /* Optional. */
      }


      finishDrag();

    }
  );


  el.stage.addEventListener(
    "pointercancel",
    () => {

      if (drag) {
        cancelDrag();
      }

    }
  );


  /*
    Edge buttons.
  */

  el.edgePrev.addEventListener(
    "click",
    () => {

      if (
        state.slotIndex > 0
      ) {

        turnPage(-1);

      }

    }
  );


  el.edgeNext.addEventListener(
    "click",
    () => {

      if (
        state.slotIndex <
        state.book.length - 1
      ) {

        turnPage(1);

      }

    }
  );

}


/* ============================================================
   27. DRAG UPDATE
=======================
