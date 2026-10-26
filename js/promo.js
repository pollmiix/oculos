(() => {
  const dialog = document.getElementById("pixWelcome");
  if (!dialog || typeof dialog.showModal !== "function") return;
  const sessionKey = "vemari_pix_welcome_10_v1";
  // Keep product links and checkout navigation uninterrupted.
  if (window.location.hash) return;
  try {
    if (sessionStorage.getItem(sessionKey)) return;
  } catch {
    // The offer remains available when browser storage is disabled.
  }
  dialog.querySelectorAll("[data-close-pix-welcome]").forEach((button) => {
    button.addEventListener("click", () => dialog.close());
  });
  dialog.addEventListener("close", () => document.body.classList.remove("pix-welcome-open"));
  dialog.showModal();
  document.body.classList.add("pix-welcome-open");
  try {
    sessionStorage.setItem(sessionKey, "shown");
  } catch {
    // Showing the offer does not depend on storage access.
  }
})();
