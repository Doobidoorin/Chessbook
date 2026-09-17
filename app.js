const SUPABASE_URL = "https://zframxxhjajaweklenyz.supabase.co/rest/v1/";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_69jX0k_c1AkxonK_cjtrHQ_jZoRzuXf";

const supabaseClient = window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY
);
const cover = document.getElementById("book-cover");

cover.addEventListener("click", () => {
  document.body.innerHTML = `
    <main style="
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      background: #140c0e;
      color: #f3e7d2;
      font-family: Georgia, serif;
      text-align: center;
    ">
      <h1>Contents</h1>
    </main>
  `;
});
