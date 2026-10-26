(() => {
  let events;
  const icons = {
    overview: '<path d="m3 10 9-7 9 7v10H3Z"/><path d="M9 20v-7h6v7"/>',
    orders: '<path d="M5 18 19 4M9 4h10v10"/>',
    catalog: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18M15 3v18M3 9h18M3 15h18"/>',
    pix: '<path d="m12 3 9 9-9 9-9-9Z"/>',
    gateway: '<path d="m12 3 9 9-9 9-9-9Z"/><path d="m12 8 4 4-4 4-4-4Z"/>',
    customers: '<circle cx="9" cy="8" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3M17 5a3 3 0 0 1 0 6M19 15a5 5 0 0 1 2 4v2"/>',
    analytics: '<path d="M4 21V11M12 21V3M20 21v-7"/>',
    settings: '<circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2"/>',
    privacy: '<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6Z"/><path d="m8 12 3 3 5-6"/>',
    accounts: '<circle cx="12" cy="8" r="4"/><path d="M4 22v-2a8 8 0 0 1 16 0v2"/>'
  };
  const icon = key => `<svg viewBox="0 0 24 24" aria-hidden="true">${icons[key] || icons.overview}</svg>`;

  window.organizarPainel = ({ estado, role, report, request, money, escape: esc }) => {
    events?.abort();
    events = new AbortController();
    const signal = events.signal;
    const owner = role === "owner";
    const app = document.getElementById("app");
    const shell = app.querySelector(".painel");
    const overview = document.getElementById("admin-overview");
    const privacy = document.getElementById("admin-privacy");
    const editor = shell.querySelector(".admin-editor");
    const accounts = editor.querySelector(".admin-privacy");
    const [settings, payments, catalog] = editor.querySelectorAll(".admin-editor-section");
    const save = document.getElementById("salvarTudo");
    const logout = document.getElementById("sairAdmin");
    const reset = document.getElementById("resetar");
    const reports = document.createElement("section");
    reports.className = "admin-data dashboard-reports";
    reports.innerHTML = '<div class="dashboard-report-actions"><a id="dashboardExport" class="btn btn-ghost">Exportar CSV</a></div>';
    reports.append(document.getElementById("adminDataView"));
    const panels = { overview, reports, privacy, accounts, settings, payments, catalog };
    Object.entries(panels).forEach(([key, panel]) => {
      panel.dataset.adminPanel = key;
      panel.remove();
    });
    save.remove(); logout.remove(); reset.remove();
    shell.replaceChildren();
    shell.classList.add("admin-shell");
    app.classList.add("admin-workspace");
    const entries = [
      ["overview", "Visão geral"], ["orders", "Vendas", true], ["catalog", "Produtos", true],
      ["pix", "Pix", true], ["gateway", "Gateway", true],
      ["customers", "Clientes", true], ["analytics", "Visitantes"],
      ["settings", "Configurações", true], ["accounts", "Acessos", true], ["privacy", "Privacidade"]
    ].filter(([, , restricted]) => owner || !restricted);
    shell.innerHTML = `
      <button class="dashboard-shade" type="button" aria-label="Fechar menu" hidden></button>
      <aside class="dashboard-sidebar" id="dashboardSidebar">
        <a class="dashboard-brand" href="index.html"><img src="imagens/vemari-logo-branco.png" alt=""><span><strong>${esc(estado.loja.nome)}</strong><small>PAINEL DA LOJA</small></span></a>
        <p class="dashboard-menu-label">MENU PRINCIPAL</p>
        <nav aria-label="Menu do painel">${entries.map(([key, label]) => `<button type="button" data-dashboard-view="${key}">${icon(key)}<span>${label}</span>${key === "catalog" ? `<small data-catalog-count>${estado.produtos.length}</small>` : key === "orders" ? '<small data-order-count></small>' : ""}</button>`).join("")}</nav>
        <div class="dashboard-sidebar-bottom"><div class="dashboard-connection"><i></i><span><strong>Dados da loja</strong><small>Catálogo compartilhado pelo servidor</small></span></div><p>Gerencie sua loja em um só lugar.</p><div id="dashboardLogout"></div></div>
      </aside>
      <div class="dashboard-main">
        <header class="dashboard-header"><div class="dashboard-heading"><button id="dashboardMenu" class="dashboard-menu-toggle" type="button" aria-label="Abrir menu" aria-controls="dashboardSidebar" aria-expanded="false">☰</button><div><p>VEMARI ÓTICA · ADMINISTRAÇÃO</p><h1 id="dashboardTitle">Visão geral</h1></div></div><div class="dashboard-header-actions"><span class="dashboard-session"><i></i>Sessão ativa</span><a class="btn btn-ghost" href="index.html" target="_blank" rel="noopener">Ver loja ↗</a><div id="dashboardSave"></div></div></header>
        <main class="dashboard-content"><p class="dashboard-save-hint" id="adminSaveHint" role="status" hidden></p><div id="dashboardPanels"></div><footer class="dashboard-footer">${esc(estado.loja.nome)} · Catálogo, pedidos e configurações da loja</footer></main>
      </div>`;
    document.getElementById("dashboardLogout").append(logout);
    document.getElementById("dashboardSave").append(save);
    logout.textContent = "Sair do painel";
    settings.append(reset);
    reset.classList.add("dashboard-reset");
    overview.querySelector(".admin-data-heading").innerHTML = `<div><h2 id="adminOverviewTitle">Resumo da loja</h2><p>Acompanhe os pedidos e os produtos da sua loja.</p></div><time>${new Date().toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo", weekday: "long", day: "numeric", month: "long", year: "numeric" })}</time>`;
    overview.querySelector(".admin-data-actions").remove();
    const charts = overview.querySelector("#adminCharts");
    const details = document.createElement("details");
    details.className = "dashboard-trends";
    details.innerHTML = '<summary>Mais indicadores e gráficos do período</summary><p id="adminExtraMetrics"></p>';
    details.append(charts);
    overview.append(details);
    const note = document.createElement("div");
    note.className = "dashboard-privacy-note";
    note.innerHTML = `${icon("privacy")}<strong>Privacidade por padrão</strong><p>Catálogo, estoque e pedidos são compartilhados com a loja pelo servidor.</p><span>IP <b>Não coletado</b></span><span>Endereço <b>Usado para entrega</b></span>`;
    overview.append(note);
    if (owner) {
      const recent = document.createElement("section");
      recent.className = "dashboard-recent";
      recent.innerHTML = '<div class="dashboard-section-heading"><div><h2>Pedidos recentes</h2><p>Confira o recebimento antes de confirmar um pagamento.</p></div><button class="btn btn-ghost" data-dashboard-view="orders" type="button">Ver todas as vendas →</button></div><div id="dashboardRecentOrders"><p class="dashboard-empty">Carregando pedidos...</p></div>';
      overview.append(recent);
    }
    const host = document.getElementById("dashboardPanels");
    Object.entries(panels).forEach(([key, panel]) => {
      panel.hidden = true;
      if (!owner && ["accounts", "settings", "payments", "catalog"].includes(key)) panel.dataset.ownerPanel = "true";
      host.append(panel);
    });
    const titles = { overview: "Visão geral", orders: "Vendas", catalog: "Produtos", pix: "Pix", gateway: "Gateway", customers: "Clientes", analytics: "Visitantes", settings: "Configurações", accounts: "Acessos", privacy: "Privacidade", products: "Estoque e vendas" };
    const reportKeys = ["orders", "customers", "analytics", "products"];
    const allowed = new Set(entries.map(([key]) => key));
    if (owner) allowed.add("products");
    function select(view, updateHash = true) {
      if (!allowed.has(view)) view = "overview";
      const panelKey = reportKeys.includes(view) ? "reports" : ["pix", "gateway"].includes(view) ? "payments" : view;
      Object.entries(panels).forEach(([key, panel]) => { panel.hidden = key !== panelKey || panel.dataset.ownerPanel === "true"; });
      document.getElementById("dashboardTitle").textContent = titles[view];
      shell.querySelectorAll("[data-dashboard-view]").forEach(button => {
        if (button.dataset.dashboardView === view) button.setAttribute("aria-current", "page");
        else button.removeAttribute("aria-current");
      });
      const editable = owner && ["catalog", "settings", "pix", "gateway"].includes(view);
      save.hidden = !editable;
      document.getElementById("adminSaveHint").hidden = !editable;
      if (panelKey === "payments") {
        document.getElementById("pixSettings").hidden = view !== "pix";
        document.getElementById("gatewaySettings").hidden = view !== "gateway";
      }
      const exportLink = document.getElementById("dashboardExport");
      const exportKind = { orders: "orders", products: "products", analytics: "traffic" }[view];
      exportLink.hidden = !exportKind || !owner;
      if (exportKind) exportLink.href = `/api/admin/export.csv?kind=${exportKind}`;
      const loading = reportKeys.includes(view) ? report(view) : Promise.resolve();
      if (updateHash) history.replaceState(null, "", `#painel/${view}`);
      setMenu(false);
      window.scrollTo(0, 0);
      return loading;
    }
    function setMenu(open) {
      shell.classList.toggle("dashboard-menu-open", open);
      shell.querySelector(".dashboard-shade").hidden = !open;
      document.getElementById("dashboardMenu").setAttribute("aria-expanded", String(open));
    }
    shell.querySelectorAll("[data-dashboard-view]").forEach(button => button.addEventListener("click", () => select(button.dataset.dashboardView), { signal }));
    document.getElementById("dashboardMenu").addEventListener("click", () => setMenu(!shell.classList.contains("dashboard-menu-open")), { signal });
    shell.querySelector(".dashboard-shade").addEventListener("click", () => setMenu(false), { signal });
    window.addEventListener("keydown", event => { if (event.key === "Escape") setMenu(false); }, { signal });
    shell.addEventListener("input", event => {
      if (event.target.matches("input:not([type=search]), textarea, select")) document.getElementById("adminSaveHint").textContent = "Você tem alterações. Clique em Salvar alterações para publicar.";
    }, { signal });
    payments.querySelectorAll('input[name="metodoPagamento"]').forEach(radio => radio.addEventListener("change", () => select(radio.value === "pix" ? "pix" : "gateway"), { signal }));
    const stockLink = document.createElement("button");
    stockLink.className = "btn btn-ghost";
    stockLink.type = "button";
    stockLink.textContent = "Ver estoque e vendas";
    stockLink.addEventListener("click", () => select("products"), { signal });
    catalog.querySelector(".products-heading").append(stockLink);
    select(location.hash.startsWith("#painel/") ? location.hash.slice(8) : "overview", false);
    if (owner) {
      const target = document.getElementById("dashboardRecentOrders");
      request("/api/admin/orders").then(({ orders }) => {
        const labels = { pending: "Aguardando Pix", reported: "Pagamento informado", paid: "Pago", cancelled: "Cancelado", refunded: "Reembolsado" };
        const latest = [...orders].sort((a, b) => b.created_at - a.created_at).slice(0, 5);
        target.innerHTML = latest.length ? `<div class="admin-table-wrap"><table><thead><tr><th>Pedido</th><th>Cliente</th><th>Data</th><th>Valor</th><th>Status</th></tr></thead><tbody>${latest.map(o => `<tr><td><button class="dashboard-order-link" type="button" data-open-order="${esc(o.id)}">#${esc(o.id)}</button></td><td>${esc(o.customer?.name || "Cliente")}</td><td>${esc(new Date(o.created_at * 1000).toLocaleString("pt-BR"))}</td><td><strong>${money(o.total_cents)}</strong></td><td><span class="order-status" data-status="${esc(o.payment_status)}">${esc(labels[o.payment_status] || o.payment_status)}</span></td></tr>`).join("")}</tbody></table></div>` : '<p class="dashboard-empty">Nenhum pedido recebido ainda. As compras feitas na loja aparecerão aqui.</p>';
        target.querySelectorAll("[data-open-order]").forEach(button => button.addEventListener("click", async () => {
          await select("orders");
          const order = reports.querySelector(`[data-save-order="${CSS.escape(button.dataset.openOrder)}"]`)?.closest("details");
          if (order) {
            order.open = true;
            order.scrollIntoView({ behavior: "smooth", block: "center" });
          }
        }, { signal }));
      }).catch(error => { target.innerHTML = `<p class="dashboard-empty">${esc(error.message)}</p>`; });
    }
  };
})();
