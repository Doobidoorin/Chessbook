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
