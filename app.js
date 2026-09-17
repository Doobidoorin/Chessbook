const SUPABASE_URL = "https://zframxxhjajaweklenyz.supabase.co/rest/v1/";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_69jX0k_c1AkxonK_cjtrHQ_jZoRzuXf";

const supabaseClient = window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY
);

const cover = document.getElementById("book-cover");
const contentsPage = document.getElementById("contents-page");
const contentsList = document.getElementById("contents-list");
const notebookPage = document.getElementById("notebook-page");

cover.addEventListener("click", () => {
  cover.style.display = "none";
  contentsPage.style.display = "block";
});

async function loadContents() {
  if (!contentsList) return;

  contentsList.innerHTML = "";

  const { data, error } = await supabaseClient
    .from("notebook_pages")
    .select("page_number, title")
    .order("page_number", { ascending: true });

  if (error) {
    console.error("Could not load contents:", error);
    return;
  }

  data.forEach((page) => {
    if (!page.title || !page.title.trim()) return;

    const entry = document.createElement("div");
    entry.className = "contents-entry";

    const title = document.createElement("span");
    title.textContent = page.title;

    const pageNumber = document.createElement("span");
    pageNumber.textContent = page.page_number;

    entry.appendChild(title);
    entry.appendChild(pageNumber);

    contentsList.appendChild(entry);
  });
}

loadContents();
