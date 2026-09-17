const SUPABASE_URL = "https://zframxxhjajaweklenyz.supabase.co/rest/v1/";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_69jX0k_c1AkxonK_cjtrHQ_jZoRzuXf";

const supabaseClient = window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY
);
const cover = document.getElementById("book-cover");

cover.addEventListener("click", () => {
  cover.style.display = "none";
  document.getElementById("contents-page").style.display = "block";
});
async function loadContents() {
  const contentsList = document.querySelector(".contents-list");

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
    if (!page.title.trim()) return;

    const entry = document.createElement("div");
    entry.className = "contents-entry";

    entry.innerHTML = `
      <span>${page.title}</span>
      <span>${page.page_number}</span>
    `;

    contentsList.appendChild(entry);
  });
}
