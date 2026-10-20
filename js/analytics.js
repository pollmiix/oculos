(() => {
  const CONSENT = "mn_analytics_consent_v1";
  const SESSION = "mn_analytics_session_v1";
  let sessionId = null;

  function getSession() {
    if (sessionId) return sessionId;
    try {
      sessionId = sessionStorage.getItem(SESSION) || crypto.randomUUID();
      sessionStorage.setItem(SESSION, sessionId);
      return sessionId;
    } catch { return null; }
  }

  function consented() {
    try { return localStorage.getItem(CONSENT) === "accepted"; } catch { return false; }
  }

  function hasChoice() {
    try { return localStorage.getItem(CONSENT) === "accepted" || localStorage.getItem(CONSENT) === "rejected"; } catch { return false; }
  }

  function track(name, details = {}) {
    if (!consented()) return;
    const id = getSession();
    if (!id) return;
    const referrer = document.referrer;
    let source = "direct";
    try { if (referrer) source = new URL(referrer).origin; } catch {}
    const agent = navigator.userAgent;
    const device = /tablet|ipad/i.test(agent) ? "tablet" : /mobile|android|iphone/i.test(agent) ? "mobile" : "desktop";
    const browser = /edg\//i.test(agent) ? "edge" : /firefox\//i.test(agent) ? "firefox" : /chrome\//i.test(agent) ? "chrome" : /safari\//i.test(agent) ? "safari" : "other";
    fetch("/api/events", { method: "POST", headers: { "Content-Type": "application/json" }, keepalive: true,
      body: JSON.stringify({ name, sessionId: id, page: location.pathname, productId: details.productId || "", source, device, browser })
    }).catch(() => {});
  }

  function showConsent(force = false) {
    if ((!force && hasChoice()) || document.getElementById("analyticsConsent")) return;
    const box = document.createElement("aside");
    box.id = "analyticsConsent";
    box.setAttribute("aria-label", "Preferências de privacidade");
    box.innerHTML = '<div><strong>Privacidade e métricas</strong><p>As métricas só são enviadas com sua autorização. O endereço IP bruto não é armazenado. Você pode recusar sem afetar a loja.</p><details><summary>O que é registrado?</summary><p>Após aceitar, registramos páginas, eventos de navegação e compra confirmada, origem do acesso sem parâmetros da URL, categoria de dispositivo/navegador e um identificador aleatório temporário. Não enviamos nome, e-mail, telefone, termos pesquisados ou endereço IP às métricas. Para reduzir abusos, um código HMAC temporário derivado do endereço de conexão é usado para limitar tentativas; ele não é usado nas métricas. Os eventos são removidos conforme o prazo configurado no servidor. Altere sua escolha na página Privacidade e dados.</p></details></div><div><button type="button" data-consent="reject">Recusar</button><button type="button" data-consent="accept">Aceitar métricas</button></div>';
    Object.assign(box.style, { position: "fixed", zIndex: "10000", left: "16px", right: "16px", bottom: "16px", maxWidth: "760px", margin: "auto", display: "flex", gap: "18px", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", padding: "18px", background: "#111", color: "#fff", border: "1px solid #555", borderRadius: "12px", boxShadow: "0 8px 28px #0004", font: "14px/1.5 system-ui,sans-serif" });
    box.querySelector("p").style.cssText = "margin:4px 0 0;color:#ddd;max-width:500px";
    box.querySelector("details").style.cssText = "margin-top:8px;color:#ddd;font-size:12px;max-width:560px";
    box.querySelectorAll("button").forEach((button) => { button.style.cssText = "padding:10px 14px;margin:4px;border:1px solid #fff;border-radius:7px;background:#fff;color:#111;font-weight:700;cursor:pointer"; });
    box.addEventListener("click", (event) => {
      const button = event.target.closest("[data-consent]");
      if (!button) return;
      const wasAccepted = consented();
      try { localStorage.setItem(CONSENT, button.dataset.consent === "accept" ? "accepted" : "rejected"); } catch {}
      box.remove();
      if (consented() && !wasAccepted) track("page_view");
    });
    document.body.append(box);
  }

  window.storeAnalytics = { track, hasConsent: consented, sessionId: () => consented() ? getSession() : null };
  document.addEventListener("DOMContentLoaded", () => {
    if (consented()) track("page_view"); else if (!hasChoice()) showConsent();
    document.querySelectorAll("[data-open-consent]").forEach((control) => {
      control.addEventListener("click", (event) => {
        event.preventDefault();
        showConsent(true);
      });
    });
    let timer;
    document.querySelectorAll('input[type="search"], #busca, #filterSearchInput').forEach((input) => input.addEventListener("input", () => {
      clearTimeout(timer);
      if (input.value.trim()) timer = setTimeout(() => track("search"), 800);
    }));
  });
})();
