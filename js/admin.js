const STORAGE_LOJA = "mineironet_loja";
let adminCsrfToken = "";
let adminRole = "owner";

let estado = window.carregarLojaConfigurada();

function salvar() {
  localStorage.setItem(STORAGE_LOJA, JSON.stringify(estado));
}

async function lerRespostaApi(response) {
  const texto = await response.text();
  if (!texto.trim()) {
    throw new Error("O servidor da loja não respondeu. Confira se a API está publicada nesta hospedagem.");
  }
  try {
    return JSON.parse(texto);
  } catch {
    throw new Error("A API da loja não está funcionando neste endereço. Confira a configuração PHP e MySQL da hospedagem.");
  }
}

function novoIdProduto() {
  let id = `p${Date.now()}`;
  while (estado.produtos.some((produto) => produto.id === id)) {
    id = `p${Number(id.slice(1)) + 1}`;
  }
  return id;
}

function atualizarContagemProdutos() {
  document.querySelectorAll("[data-catalog-count]").forEach(el => { el.textContent = estado.produtos.length; });
  const contador = document.getElementById("contagemProdutos");
  if (contador) {
    contador.textContent = `${estado.produtos.length} ${estado.produtos.length === 1 ? "produto cadastrado" : "produtos cadastrados"}`;
  }
}

function fileParaDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error(`Não foi possível ler o arquivo ${file.name}.`));
    reader.onabort = () => reject(new Error(`A leitura do arquivo ${file.name} foi cancelada.`));
    reader.readAsDataURL(file);
  });
}

function renderLogin() {
  document.getElementById("app").classList.remove("admin-workspace");
  document.getElementById("app").innerHTML = `
    <div class="login">
      <h1>Painel da loja</h1>
      <p>Acesse com a conta administrativa configurada no servidor.</p>
      <label for="usuario">Usuário</label>
      <input type="text" id="usuario" value="admin" autocomplete="username" required>
      <label for="senha">Senha</label>
      <input type="password" id="senha" autocomplete="current-password" required>
      <button class="btn btn-verde" id="entrar">Entrar</button>
    </div>`;
  document.getElementById("entrar").onclick = async () => {
    const button = document.getElementById("entrar");
    button.disabled = true;
    try {
      const response = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: document.getElementById("usuario").value.trim(),
          password: document.getElementById("senha").value
        })
      });
      const result = await lerRespostaApi(response);
      if (!response.ok) throw new Error(result.error || "Não foi possível entrar.");
      adminCsrfToken = result.csrfToken;
      adminRole = result.admin?.role || "analyst";
      estado = await window.carregarLojaRemota();
      renderPainel();
    } catch (errorLogin) {
      alert(errorLogin.message.includes("fetch") ? "O painel exige conexão com o servidor da loja." : errorLogin.message);
    } finally {
      button.disabled = false;
    }
  };
}

function renderPainel() {
  document.getElementById("app").innerHTML = `
    <div class="painel">
      <div class="topo">
        <h1>Editar loja</h1>
        <div>
          <a class="btn btn-ghost" href="index.html">Ver loja</a>
          <button class="btn btn-ghost" id="sairAdmin" type="button">Sair</button>
          <button class="btn btn-ghost" id="resetar">Restaurar padrão</button>
        </div>
      </div>
      <p class="aviso">Atualize os dados, pre&#231;os e estoque do cat&#225;logo e salve para publicar as altera&#231;&#245;es. As imagens podem ser enviadas ou informadas por URL.</p>

      <nav class="admin-sidebar" aria-label="Navegação administrativa"><a href="#admin-overview">Visão geral</a><button data-admin-view="orders" data-owner-only type="button">Pedidos e escolhas</button><button data-admin-view="customers" data-owner-only type="button">Clientes</button><button data-admin-view="products" data-owner-only type="button">Estoque e vendas</button><button data-admin-view="analytics" type="button">Visitantes</button><a href="#admin-products" data-owner-only>Catálogo de produtos</a><a href="#admin-settings" data-owner-only>Configurações</a><a href="#admin-privacy">Privacidade</a></nav>
      <section id="admin-overview" class="admin-data" aria-labelledby="adminOverviewTitle">
        <div class="admin-data-heading"><div><h2 id="adminOverviewTitle">Visão geral</h2><p>Indicadores de pedidos e visitas com consentimento.</p></div><a data-owner-only class="btn btn-ghost" href="/api/admin/export.csv?kind=orders">Exportar pedidos CSV</a><a data-owner-only class="btn btn-ghost" href="/api/admin/export.csv?kind=products">Exportar produtos CSV</a></div>
        <div class="admin-period">Periodo<select id="dashboardPeriod"><option value="7">7 dias</option><option value="30" selected>30 dias</option><option value="90">90 dias</option></select></div>
        <div id="adminMetrics" class="admin-metrics"><p>Carregando dados do servidor...</p></div><div id="adminCharts" class="admin-charts"></div>
        <div class="admin-data-actions"><button class="btn btn-ghost" data-admin-view="orders" data-owner-only>Pedidos</button><button class="btn btn-ghost" data-admin-view="customers" data-owner-only>Clientes</button><button class="btn btn-ghost" data-admin-view="analytics">Visitas e conversão</button><a data-owner-only class="btn btn-ghost" href="/api/admin/export.csv?kind=traffic">Exportar visitas CSV</a></div>
        <div id="adminDataView" class="admin-data-view" aria-live="polite"><p>Relatórios com dados registrados. Endereços IP não são armazenados.</p></div>
      </section>
      <section id="admin-privacy" class="admin-privacy"><h2>Privacidade e seguran&#231;a</h2><p>O painel registra opera&#231;&#245;es administrativas, protege rotas por sess&#227;o e CSRF e n&#227;o grava IPs. Analytics s&#243; &#233; enviado ap&#243;s consentimento; eventos pseud&#244;nimos s&#227;o removidos conforme a reten&#231;&#227;o do servidor.</p><p>Contatos e endere&#231;os de entrega s&#227;o usados para processar pedidos e ficam dispon&#237;veis apenas a administradores autenticados.</p></section>
      <div class="admin-editor" data-owner-only>
      <section class="admin-privacy"><h2>Contas de an&#225;lise</h2><p>Estas contas acessam o resumo e os relat&#243;rios de visitantes. N&#227;o podem consultar pedidos, clientes ou configura&#231;&#245;es da loja.</p><div class="admin-account-form"><label>Usu&#225;rio<input id="newAdminUsername" autocomplete="off" minlength="3" maxlength="50"></label><label>Senha tempor&#225;ria (m&#237;nimo 12 caracteres)<input id="newAdminPassword" type="password" autocomplete="new-password" minlength="12"></label><button class="btn btn-ghost" id="createAnalyst" type="button">Criar conta de an&#225;lise</button></div><div id="adminAccountsList"></div></section>
      <section class="admin-editor-section">
      <h2 id="admin-settings">Identidade e fotos da loja</h2>
      <div class="grid2">
        <div>
          <label>Nome da loja<input id="loja_nome" value="${estado.loja.nome}"></label>
          <label>Razão social<input id="loja_razaoSocial" value="${estado.loja.razaoSocial}"></label>
          <label>Slogan<input id="loja_slogan" value="${estado.loja.slogan}"></label>
          <label>WhatsApp (55DDDNUMERO)<input id="loja_whatsapp" value="${estado.loja.whatsapp}"></label>
          <label>Telefone<input id="loja_telefone" value="${estado.loja.telefone}"></label>
          <label>E-mail<input id="loja_email" value="${estado.loja.email}"></label>
          <label>Endereço<input id="loja_endereco" value="${estado.loja.endereco}"></label>
          <label>Horário<input id="loja_horario" value="${estado.loja.horario}"></label>
        </div>
        <div>
          <p>Logo atual</p>
          <img class="preview" id="prevLogo" src="${estado.loja.logo}" alt="logo">
          <label>Arquivo do logo<input type="file" accept="image/*" id="fileLogo"></label>
          <label>Caminho/URL do logo<input id="loja_logo" value="${estado.loja.logo.startsWith("data:") ? "" : estado.loja.logo}"></label>
          <p>Banner atual</p>
          <img class="preview" id="prevBanner" src="${estado.loja.banner}" alt="banner">
          <label>Arquivo do banner<input type="file" accept="image/*" id="fileBanner"></label>
          <label>Caminho/URL do banner<input id="loja_banner" value="${estado.loja.banner.startsWith("data:") ? "" : estado.loja.banner}"></label>
        </div>
      </div>

      </section>
      <section class="admin-editor-section">
      <h2>Forma de pagamento do site</h2>
      <p>Escolha como quer receber. PIX pode gerar QR Code no checkout. Gateway só deve ser ativado depois de configurar a integração segura no servidor.</p>
      <div class="payment-method-options" role="radiogroup" aria-label="Forma de pagamento">
        <label class="payment-method-option">
          <input type="radio" name="metodoPagamento" value="pix" ${estado.pagamento.metodo === "pix" ? "checked" : ""}>
          <span><strong>PIX</strong><small>QR Code e código Copia e Cola gerados para cada pedido.</small></span>
        </label>
        <label class="payment-method-option">
          <input type="radio" name="metodoPagamento" value="gateway" ${estado.pagamento.metodo === "gateway" ? "checked" : ""}>
          <span><strong>Gateway de pagamento</strong><small>Checkout automático via API, depois de configurado no servidor.</small></span>
        </label>
      </div>

      <div id="pixSettings">
      <h2>Chave PIX e QR Code</h2>
      <p class="aviso">Cadastre uma chave PIX válida. Ela será usada para gerar o QR Code da cobrança no checkout. Confira os dados com cuidado antes de receber pagamentos.</p>
      <div class="grid2">
        <label>Tipo de chave PIX
          <select id="pix_tipo">
            ${["CPF", "CNPJ", "Telefone", "E-mail", "Aleatória"].map((tipo) => `<option value="${tipo}" ${String(estado.pix.tipo).toLowerCase() === tipo.toLowerCase() ? "selected" : ""}>${tipo}</option>`).join("")}
          </select>
        </label>
        <label>Chave PIX<input id="pix_chave" value="${esc(estado.pix.chave)}" autocomplete="off" placeholder="Informe a chave cadastrada no seu banco"></label>
        <label>Nome do recebedor<input id="pix_nomeRecebedor" value="${esc(estado.pix.nomeRecebedor)}" maxlength="25"></label>
        <label>Cidade do recebedor<input id="pix_cidade" value="${esc(estado.pix.cidade)}" maxlength="15"></label>
      </div>
      <div class="pix-admin-preview">
        <div>
          <h3>Prévia do QR Code</h3>
          <p>Gere uma prévia do QR PIX estático da chave informada. Este QR de prévia não define valor; o QR de cada pedido mostrará o total no checkout.</p>
          <button class="btn btn-ghost" id="gerarPixPreview" type="button">Gerar prévia do QR Code</button>
          <p id="pixPreviewStatus" class="pix-preview-status" role="status"></p>
        </div>
        <div class="pix-preview-image" id="pixPreviewImage" hidden></div>
      </div>
      </div>

      <div id="gatewaySettings" hidden>
        <h2>Gateway BlackCat</h2>
        <div class="gateway-connection-card">
          <p id="gatewayConnectionStatus" role="status">Conferindo a configuração do servidor...</p>
          <ul id="gatewayConnectionSteps"></ul>
          <div class="gateway-connection-actions"><button class="btn btn-ghost" id="testGateway" type="button">Verificar conexão</button><button class="btn btn-verde" id="activateGateway" type="button" disabled>Ativar Pix automático</button></div>
          <p id="gatewayConnectionResult" role="status"></p>
        </div>
        <div class="grid2">
          <label>Provedor<input id="gateway_provedor" value="${esc(estado.pagamento.gateway.provedor || "BlackCat")}" readonly></label>
        </div>
        <div class="aviso gateway-security-note">
          <strong>Chave privada: configure somente no servidor</strong>
          <p>Na Vercel, abra o projeto da loja → Settings → Environment Variables. Cadastre a nova chave privada como <code>BLACKCAT_API_KEY</code> em Production e faça Redeploy. Depois clique em “Verificar conexão”.</p>
          <p>O Pix automático gera a cobrança, recebe a notificação de pagamento e confere o valor diretamente na BlackCat antes de atualizar o pedido.</p>
          <a class="btn btn-ghost" href="https://vercel.com/dashboard" target="_blank" rel="noopener">Abrir Vercel ↗</a>
        </div>
      </div>

      </section>
      <section class="admin-editor-section">
      <div class="products-heading" id="admin-products">
        <div>
          <h2>Catálogo de produtos</h2>
          <p id="contagemProdutos" class="products-count"></p>
        </div>
        <button class="btn btn-ouro" id="novoProduto" type="button">＋ Adicionar produto</button>
      </div>
      <p class="aviso">Pesquise pelo nome ou filtre por categoria. Abra um produto para editar preço, estoque, fotos e descrição. Para catálogos grandes, prefira imagens hospedadas no site e informe o caminho ou URL.</p>
      <div class="products-toolbar" role="search">
        <label>Buscar produto<input id="productSearch" type="search" placeholder="Nome do produto"></label>
        <label>Categoria<select id="productCategoryFilter"><option value="">Todas as categorias</option></select></label>
        <button class="btn btn-ghost" id="clearProductFilters" type="button">Limpar filtros</button>
      </div>
      <p id="productFilterCount" class="products-count" aria-live="polite"></p>
      <div id="listaProdutos"></div>
      <p><button class="btn btn-verde" id="salvarTudo" type="button">Salvar alterações</button></p>
      </section>
      </div>
    </div>`;

  if (adminRole !== "owner") document.querySelectorAll("[data-owner-only]").forEach((element) => { element.hidden = true; });
  else {
    carregarContasAdmin();
    document.getElementById("createAnalyst").onclick = criarContaAnalista;
  }
  document.getElementById("sairAdmin").onclick = async () => {
    try { await fetch("/api/admin/logout", { method: "POST", headers: { "X-CSRF-Token": adminCsrfToken } }); } finally { adminCsrfToken = ""; renderLogin(); }
  };
  carregarIndicadoresAdmin();
  document.getElementById("dashboardPeriod").onchange = (event) => carregarIndicadoresAdmin(Number(event.target.value));
  document.querySelectorAll("[data-admin-view]").forEach((button) => {
    button.onclick = () => carregarRelatorioAdmin(button.dataset.adminView);
  });
  document.getElementById("fileLogo").onchange = async (e) => {
    if (!e.target.files[0]) return;
    estado.loja.logo = await fileParaDataUrl(e.target.files[0]);
    document.getElementById("prevLogo").src = estado.loja.logo;
  };
  document.getElementById("fileBanner").onchange = async (e) => {
    if (!e.target.files[0]) return;
    estado.loja.banner = await fileParaDataUrl(e.target.files[0]);
    document.getElementById("prevBanner").src = estado.loja.banner;
  };
  document.getElementById("novoProduto").onclick = () => {
    lerCamposLoja();
    estado.produtos.unshift({
      id: novoIdProduto(),
      nome: "Novo produto",
      categoria: estado.categorias.find((categoria) => categoria !== "Todos") || estado.categorias[0],
      preco: 0,
      antigo: 0,
      estoque: 13,
      destaque: false,
      imagem: "imagens/produtos/oculos-inteligentes.svg",
      imagens: [],
      descricao: "Descreva o produto."
    });
    renderProdutos();
    const novoNome = document.querySelector('[data-p="0"][data-k="nome"]');
    novoNome?.focus();
    novoNome?.scrollIntoView({ behavior: "smooth", block: "center" });
  };
  document.getElementById("salvarTudo").onclick = async () => {
    lerCamposLoja();
    if (estado.pagamento.metodo === "pix" && estado.pix.chave && !window.PixBR.validarChave(estado.pix.tipo, estado.pix.chave)) {
      alert("A chave PIX não parece válida para o tipo selecionado. Confira o tipo e a chave antes de salvar.");
      document.getElementById("pix_chave").focus();
      return;
    }
    try {
      salvar();
    } catch (erro) {
      const armazenamentoCheio = erro.name === "QuotaExceededError" || erro.name === "NS_ERROR_DOM_QUOTA_REACHED";
      alert(armazenamentoCheio
        ? "O armazenamento do navegador está cheio. Use imagens menores ou URLs/caminhos de fotos hospedadas no site e tente salvar novamente."
        : `Não foi possível salvar as alterações: ${erro.message}`);
      return;
    }
    try {
      const sincronizado = await sincronizarLojaComServidor();
      if (sincronizado === false) {
        alert("As alterações foram salvas neste navegador, mas não no servidor. Para publicar os produtos e ativar pagamentos, execute o servidor da loja e sincronize novamente.");
        return;
      }
    } catch (erro) {
      alert(`As alterações ficaram salvas apenas neste navegador. Não foi possível sincronizar o servidor: ${erro.message}`);
      return;
    }
    const saveHint = document.getElementById("adminSaveHint");
    if (saveHint) saveHint.textContent = "Alterações salvas no servidor";
    alert(estado.pagamento.metodo === "gateway"
      ? "Loja sincronizada com o servidor. O gateway será habilitado quando a chave de API estiver configurada no ambiente seguro do servidor."
      : "Loja atualizada. Abra a vitrine para ver as fotos novas.");
  };
  document.getElementById("gerarPixPreview").onclick = gerarPixPreview;
  document.querySelectorAll('input[name="metodoPagamento"]').forEach((radio) => {
    radio.addEventListener("change", atualizarConfiguracaoPagamento);
  });
  atualizarConfiguracaoPagamento();
  document.getElementById("resetar").onclick = () => {
    if (!confirm("Voltar para os produtos e fotos originais?")) return;
    localStorage.removeItem(STORAGE_LOJA);
    estado = structuredClone(window.LOJA_PADRAO);
    renderPainel();
  };
  renderProdutos();
  window.organizarPainel({ estado, role: adminRole, report: carregarRelatorioAdmin, request: adminFetch, money: dinheiroAdmin, escape: esc });
  if (adminRole === "owner") window.iniciarConexaoGateway(adminCsrfToken, () => {
    estado.pagamento.metodo = "gateway";
    estado.pagamento.gateway.provedor = "BlackCat";
    document.querySelector('input[name="metodoPagamento"][value="gateway"]').checked = true;
    atualizarConfiguracaoPagamento();
    document.getElementById("adminSaveHint").textContent = "Gateway ativado no servidor";
  });
}

function lerCamposLoja() {
  estado.loja.nome = document.getElementById("loja_nome").value;
  estado.loja.razaoSocial = document.getElementById("loja_razaoSocial").value;
  estado.loja.slogan = document.getElementById("loja_slogan").value;
  estado.loja.whatsapp = document.getElementById("loja_whatsapp").value;
  estado.loja.telefone = document.getElementById("loja_telefone").value;
  estado.loja.email = document.getElementById("loja_email").value;
  estado.loja.endereco = document.getElementById("loja_endereco").value;
  estado.loja.horario = document.getElementById("loja_horario").value;
  const logoPath = document.getElementById("loja_logo").value.trim();
  const bannerPath = document.getElementById("loja_banner").value.trim();
  if (logoPath) estado.loja.logo = logoPath;
  if (bannerPath) estado.loja.banner = bannerPath;
  estado.pix.chave = document.getElementById("pix_chave").value.trim();
  estado.pix.tipo = document.getElementById("pix_tipo").value.trim();
  estado.pix.nomeRecebedor = document.getElementById("pix_nomeRecebedor").value;
  estado.pix.cidade = document.getElementById("pix_cidade").value;
  estado.pagamento.metodo = document.querySelector('input[name="metodoPagamento"]:checked').value;
  estado.pagamento.gateway.provedor = document.getElementById("gateway_provedor").value.trim();
}

async function sincronizarLojaComServidor() {
  if (window.location.protocol === "file:") return false;
  let health;
  try {
    health = await fetch("/api/health", { cache: "no-store" });
  } catch {
    return false;
  }
  if (health.status === 404) return false;
  if (!health.ok) throw new Error("A API da loja não está disponível.");
  const response = await fetch("/api/admin/store", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-CSRF-Token": adminCsrfToken
    },
    body: JSON.stringify(estado)
  });
  const resultado = await lerRespostaApi(response);
  if (!response.ok) throw new Error(resultado.error || `O servidor respondeu ${response.status}.`);
  return true;
}

function atualizarConfiguracaoPagamento() {
  const metodo = document.querySelector('input[name="metodoPagamento"]:checked').value;
  document.getElementById("pixSettings").hidden = metodo !== "pix";
  document.getElementById("gatewaySettings").hidden = metodo !== "gateway";
}

function gerarPixPreview() {
  const tipo = document.getElementById("pix_tipo").value;
  const chave = document.getElementById("pix_chave").value.trim();
  const status = document.getElementById("pixPreviewStatus");
  const preview = document.getElementById("pixPreviewImage");
  preview.hidden = true;
  preview.replaceChildren();
  if (!window.PixBR.validarChave(tipo, chave)) {
    status.textContent = "Informe uma chave PIX válida para o tipo selecionado.";
    return;
  }
  if (typeof window.qrcode !== "function") {
    status.textContent = "Não foi possível carregar o gerador de QR Code. Verifique sua conexão e tente novamente.";
    return;
  }
  try {
    const payload = window.PixBR.gerarPayload({
      chave,
      nomeRecebedor: document.getElementById("pix_nomeRecebedor").value,
      cidade: document.getElementById("pix_cidade").value,
      txid: "***"
    });
    const qr = window.qrcode(0, "M");
    qr.addData(payload, "Byte");
    qr.make();
    const imagem = document.createElement("img");
    imagem.alt = "Prévia do QR Code PIX da loja";
    imagem.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(qr.createSvgTag(6, 4, "QR Code PIX"))}`;
    preview.append(imagem);
    preview.hidden = false;
    status.textContent = "Prévia gerada. O QR Code do pedido incluirá o valor da compra.";
  } catch (erro) {
    console.error("Não foi possível gerar a prévia do QR Code PIX.", erro);
    status.textContent = "Não foi possível gerar a prévia. Confira os dados do recebedor.";
  }
}

function renderProdutos() {
  const box = document.getElementById("listaProdutos");
  atualizarContagemProdutos();
  const search = document.getElementById("productSearch");
  const categoryFilter = document.getElementById("productCategoryFilter");
  const filterCount = document.getElementById("productFilterCount");
  const searchTerm = (search?.value || "").trim().toLocaleLowerCase("pt-BR");
  const selectedCategory = categoryFilter?.value || "";
  const categories = [...new Set(estado.produtos.map((produto) => String(produto.categoria || "")).filter(Boolean))].sort((a, b) => a.localeCompare(b, "pt-BR"));
  if (categoryFilter) {
    const previousCategory = categoryFilter.value;
    categoryFilter.innerHTML = '<option value="">Todas as categorias</option>' + categories.map((category) => `<option value="${esc(category)}">${esc(category)}</option>`).join("");
    categoryFilter.value = categories.includes(previousCategory) ? previousCategory : "";
  }
  const filteredProducts = estado.produtos
    .map((product, index) => ({ product, index }))
    .filter(({ product }) => {
      const matchesSearch = !searchTerm || `${product.nome || ""} ${product.categoria || ""} ${product.descricao || ""}`.toLocaleLowerCase("pt-BR").includes(searchTerm);
      const matchesCategory = !selectedCategory || product.categoria === selectedCategory;
      return matchesSearch && matchesCategory;
    });
  if (filterCount) filterCount.textContent = `Exibindo ${filteredProducts.length} de ${estado.produtos.length} produtos`;
  box.innerHTML = filteredProducts
    .map(
      (p, i) => {
        const product = p.product;
        const index = p.index;
        const fotosExtras = Array.isArray(product.imagens) ? product.imagens : [];
        const fotosGaleria = [product.imagem, ...fotosExtras];
        return `
      <details class="prod-card">
        <summary class="prod-summary">
          <img src="${esc(product.imagem)}" alt="">
          <span class="prod-summary-main"><strong>${esc(product.nome || "Produto sem nome")}</strong><small>${esc(product.categoria || "Sem categoria")}</small></span>
          <span class="prod-summary-meta"><strong>${dinheiroAdmin(Math.round((Number(product.preco) || 0) * 100))}</strong><small>Estoque: ${Number(product.estoque) || 0}</small></span>
          <span class="prod-edit-hint">Editar <span aria-hidden="true">⌄</span></span>
        </summary>
        <div class="prod-card-content">
        <div class="prod-gallery-admin">
          <p class="prod-gallery-count">${fotosGaleria.length} foto(s) cadastrada(s)</p>
          <div class="prod-gallery-preview">
            ${fotosGaleria.map((foto, fotoIndex) => `
              <div class="prod-gallery-item">
                <img src="${esc(foto)}" alt="Foto ${fotoIndex + 1} de ${esc(product.nome)}">
                ${fotoIndex === 0
                  ? '<span class="prod-cover-label">Principal</span>'
                  : `<button class="prod-remove-photo" data-remove-photo="${index}" data-photo-index="${fotoIndex - 1}" type="button" aria-label="Remover foto ${fotoIndex + 1}">Remover</button>`}
              </div>
            `).join("")}
          </div>
          <label>Trocar foto principal<input type="file" accept="image/*" data-img="${index}"></label>
          <label>Adicionar mais fotos (pode selecionar várias)<input type="file" accept="image/*" data-imgs="${index}" multiple></label>
        </div>
        <div>
          <label>Nome<input data-p="${index}" data-k="nome" value="${esc(product.nome)}"></label>
          <label>Categoria
            <select data-p="${index}" data-k="categoria">
              ${estado.categorias
                .filter((c) => c !== "Todos")
                .map((c) => `<option ${c === product.categoria ? "selected" : ""}>${esc(c)}</option>`)
                .join("")}
            </select>
          </label>
          <div class="grid2">
            <label>Marca do fabricante<input data-p="${index}" data-k="marca" value="${esc(product.marca || product.brand || "")}"></label>
            <label>GTIN / EAN do fabricante<input data-p="${index}" data-k="gtin" inputmode="numeric" value="${esc(product.gtin || "")}" placeholder="Somente se informado pelo fabricante"></label>
            <label>MPN / código do fabricante<input data-p="${index}" data-k="mpn" value="${esc(product.mpn || "")}" placeholder="Não use um código inventado"></label>
            <label>Preço<input type="number" step="0.01" data-p="${index}" data-k="preco" value="${product.preco}"></label>
            <label>Preço antigo<input type="number" step="0.01" data-p="${index}" data-k="antigo" value="${product.antigo || 0}"></label>
            <label>Estoque<input type="number" data-p="${index}" data-k="estoque" value="${product.estoque}"></label>
            <label>Caminho da foto<input data-p="${index}" data-k="imagem" value="${product.imagem.startsWith("data:") ? "" : esc(product.imagem)}"></label>
          </div>
          <label>Outras fotos (um caminho ou URL por linha)<textarea data-p="${index}" data-k="imagens">${esc((product.imagens || []).join("\n"))}</textarea></label>
          <label>Descrição<textarea data-p="${index}" data-k="descricao">${esc(product.descricao)}</textarea></label>
          <label><input type="checkbox" data-p="${index}" data-k="destaque" ${product.destaque ? "checked" : ""}> Destaque</label>
          <div class="acoes"><button class="btn btn-ghost" data-del="${index}" type="button">Remover produto</button></div>
        </div>
        </div>
      </details>`;
      }
    )
    .join("") || '<p class="products-empty">Nenhum produto encontrado. Ajuste a busca ou a categoria selecionada.</p>';

  if (search && !search.dataset.bound) {
    search.dataset.bound = "true";
    search.addEventListener("input", renderProdutos);
    categoryFilter.addEventListener("change", renderProdutos);
    document.getElementById("clearProductFilters").onclick = () => {
      search.value = "";
      categoryFilter.value = "";
      renderProdutos();
    };
  }

  box.querySelectorAll("[data-p]").forEach((el) => {
    const aplicar = () => {
      const i = Number(el.dataset.p);
      const k = el.dataset.k;
      if (el.type === "checkbox") estado.produtos[i][k] = el.checked;
      else if (el.type === "number") {
        estado.produtos[i][k] = el.value.trim() ? Number(el.value) : null;
        if (k === "preco" && estado.produtos[i].precoPix !== null && estado.produtos[i].precoPix !== undefined) {
          estado.produtos[i].precoPix = window.precoComDescontoPix(estado.produtos[i]);
        }
      }
      else if (k === "imagem" && !el.value.trim()) return;
      else if (k === "imagens") estado.produtos[i][k] = el.value.split(/\r?\n/).map((foto) => foto.trim()).filter(Boolean);
      else estado.produtos[i][k] = el.value;
    };
    el.addEventListener("input", aplicar);
    el.addEventListener("change", aplicar);
  });
  box.querySelectorAll("[data-img]").forEach((el) => {
    el.onchange = async () => {
      if (!el.files[0]) return;
      try {
        estado.produtos[Number(el.dataset.img)].imagem = await fileParaDataUrl(el.files[0]);
      } catch (erro) {
        alert(`Não foi possível carregar a foto principal: ${erro.message}`);
        return;
      }
      renderProdutos();
    };
  });
  box.querySelectorAll("[data-imgs]").forEach((el) => {
    el.onchange = async () => {
      const files = Array.from(el.files || []);
      if (!files.length) return;
      const produto = estado.produtos[Number(el.dataset.imgs)];
      try {
        const novasFotos = await Promise.all(files.map(fileParaDataUrl));
        produto.imagens = [...(produto.imagens || []), ...novasFotos];
      } catch (erro) {
        alert(`Não foi possível carregar as fotos selecionadas: ${erro.message}`);
        return;
      }
      renderProdutos();
    };
  });
  box.querySelectorAll("[data-remove-photo]").forEach((el) => {
    el.onclick = () => {
      const produto = estado.produtos[Number(el.dataset.removePhoto)];
      produto.imagens.splice(Number(el.dataset.photoIndex), 1);
      renderProdutos();
    };
  });
  box.querySelectorAll("[data-del]").forEach((el) => {
    el.onclick = () => {
      estado.produtos.splice(Number(el.dataset.del), 1);
      renderProdutos();
    };
  });
}

async function carregarContasAdmin() {
  const target = document.getElementById("adminAccountsList");
  try {
    const { accounts } = await adminFetch("/api/admin/accounts");
    target.innerHTML = accounts.map((account) => `<div class="admin-account-row"><span>${esc(account.username)} <small>${esc(!account.active ? "Desativada" : account.role === "analyst" ? "Analista de visitantes" : "Propriet&#225;rio")}</small></span>${account.role === "analyst" && account.active ? `<button class="btn btn-ghost" data-remove-admin="${account.id}" type="button">Remover</button>` : ""}</div>`).join("");
    target.querySelectorAll("[data-remove-admin]").forEach((button) => button.onclick = async () => {
      if (!confirm("Remover esta conta de analise e encerrar suas sessoes?")) return;
      const response = await fetch(`/api/admin/accounts/${button.dataset.removeAdmin}`, { method: "DELETE", headers: { "X-CSRF-Token": adminCsrfToken } });
      if (!response.ok) { alert("Nao foi possivel remover a conta."); return; }
      carregarContasAdmin();
    });
  } catch (error) { target.textContent = error.message; }
}

async function criarContaAnalista() {
  const username = document.getElementById("newAdminUsername").value.trim();
  const password = document.getElementById("newAdminPassword").value;
  const response = await fetch("/api/admin/accounts", { method: "POST", headers: { "Content-Type": "application/json", "X-CSRF-Token": adminCsrfToken }, body: JSON.stringify({ username, password }) });
  const result = await response.json();
  if (!response.ok) { alert(result.error || "Nao foi possivel criar a conta."); return; }
  document.getElementById("newAdminUsername").value = "";
  document.getElementById("newAdminPassword").value = "";
  carregarContasAdmin();
}

async function adminFetch(path) {
  const response = await fetch(path, { cache: "no-store" });
  if (!response.ok) throw new Error("Não foi possível carregar este relatório.");
  return response.json();
}

function dinheiroAdmin(cents) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format((Number(cents) || 0) / 100);
}

async function carregarIndicadoresAdmin(days = 30) {
  const target = document.getElementById("adminMetrics");
  try {
    const m = await adminFetch(`/api/admin/dashboard?days=${days}`);
    const metrics = [
      ["Faturamento confirmado", dinheiroAdmin(m.revenueCents), "Pedidos pagos no período", "R$"],
      ["Pedidos recebidos", m.orders, `${m.pendingOrders} aguardando confirmação`, "↗"],
      ["Ticket médio", dinheiroAdmin(m.paidOrders ? Math.round(m.revenueCents / m.paidOrders) : 0), "Média dos pedidos pagos", "◎"],
      ["Produtos no catálogo", m.products, `${m.lowStock} com estoque baixo ou zerado`, "▦"]
    ];
    target.innerHTML = metrics.map(([label, value, note, icon]) => `<article class="admin-metric"><div class="metric-heading"><span>${label}</span><i aria-hidden="true">${icon}</i></div><strong>${value}</strong><small>${note}</small></article>`).join("");
    const extra = document.getElementById("adminExtraMetrics");
    if (extra) extra.textContent = `${m.paidOrders} pedidos pagos · ${m.customers} clientes · ${m.visitors} visitantes com consentimento · Conversão observada: ${m.conversionPercent}% · Últimos ${days} dias`;
    document.querySelectorAll("[data-order-count]").forEach(el => { el.textContent = m.orders; });
    const sales = m.salesByDay || [];
    const traffic = m.trafficByDay || [];
    const maxSales = Math.max(1, ...sales.map((row) => Number(row.cents) || 0));
    const maxVisitors = Math.max(1, ...traffic.map((row) => Number(row.visitors) || 0));
    const bars = (rows, field, max, title) => rows.length
      ? `<div class="admin-chart"><h3>${title}</h3><div class="admin-chart-bars">${rows.map((row) => `<div title="${esc(row.day)}: ${field === "cents" ? dinheiroAdmin(row[field]) : row[field]}" style="--bar:${Math.round((Number(row[field]) || 0) * 100 / max)}%"><span>${esc(row.day.slice(5))}</span></div>`).join("")}</div></div>`
      : `<div class="admin-chart"><h3>${title}</h3><p>Ainda não há registros neste período.</p></div>`;
    document.getElementById("adminCharts").innerHTML = bars(sales, "cents", maxSales, "Vendas confirmadas · por dia") + bars(traffic, "visitors", maxVisitors, "Visitantes consentidos · por dia");
  } catch (error) { target.innerHTML = `<p>${esc(error.message)}</p>`; }
}

async function carregarRelatorioAdmin(view) {
  const target = document.getElementById("adminDataView");
  const selectedFilters = {
    page: document.getElementById("analyticsPage")?.value.trim() || "",
    product: document.getElementById("analyticsProduct")?.value || "",
    source: document.getElementById("analyticsSource")?.value.trim() || "",
    device: document.getElementById("analyticsDevice")?.value || ""
  };
  target.innerHTML = "<p>Carregando...</p>";
  try {
    if (view === "orders") {
      const { orders } = await adminFetch("/api/admin/orders");
      const paymentLabels = { pending: "Aguardando pagamento", reported: "Pagamento informado", paid: "Pago", cancelled: "Cancelado", refunded: "Reembolsado" };
      const paymentMethods = { pix: "PIX", pix_manual: "PIX manual", blackcat: "BlackCat" };
      target.innerHTML = orders.length ? `<div class="order-list">${orders.map((o) => {
        const customer = o.customer || {};
        const shipping = customer.shipping || {};
        const items = Array.isArray(o.items) ? o.items : [];
        const destination = [shipping.street, shipping.number, shipping.neighborhood, shipping.city, shipping.state, shipping.zipCode].filter(Boolean).join(", ");
        const pixPayload = String(o.pix_payload || "");
        let pixQrMarkup = "";
        if (pixPayload && typeof window.qrcode === "function") {
          try {
            const qr = window.qrcode(0, "M");
            qr.addData(pixPayload, "Byte");
            qr.make();
            pixQrMarkup = `<img class="order-pix-qr" src="data:image/svg+xml;charset=utf-8,${encodeURIComponent(qr.createSvgTag(6, 4, "QR Code PIX do pedido"))}" alt="QR Code PIX do pedido">`;
          } catch (error) {
            console.error("Não foi possível gerar o QR Code deste pedido.", error);
          }
        }
        return `<details class="order-card">
          <summary class="order-summary">
            <span class="order-summary-main"><strong>Pedido ${esc(o.id)}</strong><small>${esc(new Date(o.created_at * 1000).toLocaleString("pt-BR"))} · ${esc(customer.name || "Cliente")}</small></span>
            <span class="order-summary-products">${items.length} ${items.length === 1 ? "produto" : "produtos"} · ${items.reduce((sum, item) => sum + Math.max(0, Number(item.quantity) || 0), 0)} un.</span>
            <span class="order-summary-total">${dinheiroAdmin(o.total_cents)}</span>
            <span class="order-status" data-status="${esc(o.payment_status || "unknown")}">${esc(paymentLabels[o.payment_status] || o.payment_status || "Status desconhecido")}</span>
          </summary>
          <div class="order-details">
            <div class="order-items"><h3>Produtos escolhidos</h3>
              ${items.length ? items.map((item) => {
                const quantity = Math.max(0, Number(item.quantity) || 0);
                const unitPrice = Number(item.unitPriceCents) || 0;
                return `<div class="order-item"><span><strong>${quantity}× ${esc(item.name || item.nome || item.id || "Produto")}</strong><small>${dinheiroAdmin(unitPrice)} cada</small></span><strong>${dinheiroAdmin(unitPrice * quantity)}</strong></div>`;
              }).join("") : "<p>Este pedido não contém itens detalhados.</p>"}
            </div>
            <div class="order-customer"><h3>Cliente e entrega</h3>
              <p><strong>${esc(customer.name || "Não informado")}</strong></p>
              <p>${esc(customer.email || "E-mail não informado")}</p>
              <p>${esc(customer.phone || "Telefone não informado")}</p>
              <p>${esc(destination || "Endereço de entrega não informado")}</p>
              ${shipping.complement ? `<p>Complemento: ${esc(shipping.complement)}</p>` : ""}
            </div>
            ${pixPayload ? `<div class="order-pix"><h3>PIX gerado · ${dinheiroAdmin(o.total_cents)}</h3><div class="order-pix-content">${pixQrMarkup}<label>Código Copia e Cola<textarea readonly rows="4">${esc(pixPayload)}</textarea></label></div><button class="btn btn-ghost" data-copy-pix type="button">Copiar código PIX</button></div>` : ""}
            <div class="order-actions"><label>Status do pagamento<select data-order-status="${esc(o.id)}">${["pending", "reported", "paid", "cancelled", "refunded"].map((value) => `<option value="${value}" ${o.payment_status === value ? "selected" : ""}>${esc(paymentLabels[value])}</option>`).join("")}</select></label>
              <p>Forma de pagamento: ${esc(paymentMethods[o.payment_method] || o.payment_method || "Não informado")}</p>
              <button class="btn btn-ghost" data-save-order="${esc(o.id)}" type="button">Atualizar pagamento</button>
            </div>
          </div>
        </details>`;
      }).join("")}</div>` : "<p>Ainda não há pedidos registrados no servidor. Quando uma compra for enviada pela loja, os produtos escolhidos e seus detalhes aparecerão aqui.</p>";
      target.querySelectorAll("[data-copy-pix]").forEach((button) => button.onclick = async () => {
        const code = button.closest(".order-pix")?.querySelector("textarea")?.value || "";
        try {
          await navigator.clipboard.writeText(code);
          button.textContent = "Código copiado";
          setTimeout(() => { button.textContent = "Copiar código PIX"; }, 1600);
        } catch (error) {
          console.error("Não foi possível copiar o código PIX.", error);
          alert("Não foi possível copiar. Selecione o código PIX manualmente.");
        }
      });
      target.querySelectorAll("[data-save-order]").forEach((button) => button.onclick = async () => {
        const orderId = button.dataset.saveOrder;
        const paymentStatus = target.querySelector(`[data-order-status="${CSS.escape(orderId)}"]`).value;
        if (paymentStatus === "paid" && !confirm("Confirme como pago somente depois de verificar o recebimento no banco ou gateway.")) return;
        button.disabled = true;
        try {
          const response = await fetch(`/api/admin/orders/${encodeURIComponent(orderId)}`, { method: "POST", headers: { "Content-Type": "application/json", "X-CSRF-Token": adminCsrfToken }, body: JSON.stringify({ paymentStatus }) });
          const result = await response.json();
          if (!response.ok) throw new Error(result.error || "Nao foi possivel atualizar o pedido.");
          await carregarRelatorioAdmin("orders");
          await carregarIndicadoresAdmin(Number(document.getElementById("dashboardPeriod")?.value || 30));
        } catch (error) { alert(error.message); button.disabled = false; }
      });
    } else if (view === "products") {
      const { products } = await adminFetch("/api/admin/products");
      target.innerHTML = `<p>Vendas consideram apenas pedidos confirmados. Estoque vem do catalogo atual.</p><div class="admin-table-wrap"><table><thead><tr><th>Produto</th><th>Categoria</th><th>Preco</th><th>Estoque</th><th>Unidades pagas</th></tr></thead><tbody>${products.length ? products.map((p) => `<tr><td>${esc(p.name)}</td><td>${esc(p.category)}</td><td>${p.priceCents == null ? "Nao informado" : dinheiroAdmin(p.priceCents)}</td><td>${p.stock == null ? "Nao informado" : p.stock}</td><td>${p.paidUnits}</td></tr>`).join("") : `<tr><td colspan="5">Nenhum produto cadastrado no servidor.</td></tr>`}</tbody></table></div><p><a class="btn btn-ghost" href="/api/admin/export.csv?kind=products">Exportar estoque e vendas CSV</a></p>`;
    } else if (view === "customers") {
      const { customers } = await adminFetch("/api/admin/customers");
      target.innerHTML = customers.length ? `<div class="admin-table-wrap"><table><thead><tr><th>Cliente</th><th>E-mail</th><th>Telefone</th><th>Pedidos</th></tr></thead><tbody>${customers.map((c) => `<tr><td>${esc(c.name || "")}</td><td>${esc(c.email || "")}</td><td>${esc(c.phone || "")}</td><td>${c.orders}</td></tr>`).join("")}</tbody></table></div>` : "<p>Os clientes aparecerao quando houver pedidos registrados.</p>";
    } else {
      const days = Number(document.getElementById("dashboardPeriod")?.value || 30);
      const filterMarkup = `<div class="analytics-filters"><label>Pagina<input id="analyticsPage" value="${esc(selectedFilters.page)}" placeholder="/produto.html"></label><label>Produto<select id="analyticsProduct"><option value="">Todos</option>${estado.produtos.map((p) => `<option value="${esc(p.id)}" ${selectedFilters.product === String(p.id) ? "selected" : ""}>${esc(p.nome)}</option>`).join("")}</select></label><label>Origem<input id="analyticsSource" value="${esc(selectedFilters.source)}" placeholder="https://origem"></label><label>Dispositivo<select id="analyticsDevice"><option value="">Todos</option><option value="desktop" ${selectedFilters.device === "desktop" ? "selected" : ""}>Computador</option><option value="mobile" ${selectedFilters.device === "mobile" ? "selected" : ""}>Celular</option><option value="tablet" ${selectedFilters.device === "tablet" ? "selected" : ""}>Tablet</option></select></label><button class="btn btn-ghost" id="applyAnalyticsFilters" type="button">Aplicar filtros</button></div>`;
      const params = new URLSearchParams({ days, ...selectedFilters });
      const a = await adminFetch(`/api/admin/analytics?${params}`);
      const events = Object.entries(a.counts || {}).map(([name, count]) => `<li>${esc(name)}: <strong>${count}</strong></li>`).join("");
      const sections = (title, rows, columns) => `<h3>${title}</h3><div class="admin-table-wrap"><table><thead><tr>${columns.map((c) => `<th>${c[0]}</th>`).join("")}</tr></thead><tbody>${rows.length ? rows.map((row) => `<tr>${columns.map((c) => `<td>${esc(row[c[1]] ?? "")}</td>`).join("")}</tr>`).join("") : `<tr><td colspan="${columns.length}">Sem dados neste periodo.</td></tr>`}</tbody></table></div>`;
      const visitRows = (a.latest || []).map((row) => ({ time: new Date(row.happened_at * 1000).toLocaleString("pt-BR"), event: row.event_name, page: row.page_path, source: row.source, device: row.device, browser: row.browser, session: String(row.session_id).slice(0, 10) }));
      target.innerHTML = filterMarkup + `<p>Somente visitantes que aceitaram analytics. Enderecos IP nao sao coletados.</p><ul>${events || "<li>Nenhum evento coletado.</li>"}</ul>` + sections("Paginas", a.pages || [], [["Pagina", "page_path"], ["Visualizacoes", "views"], ["Visitantes", "visitors"]]) + sections("Produtos", a.products || [], [["Produto", "product_id"], ["Visualizacoes", "views"], ["Visitantes", "visitors"]]) + sections("Origem", a.sources || [], [["Origem", "source"], ["Visitantes", "visitors"]]) + sections("Dispositivos e navegadores", a.devices || [], [["Dispositivo", "device"], ["Navegador", "browser"], ["Visitantes", "visitors"]]) + sections("Visitas recentes (sessao pseudonima)", visitRows, [["Data", "time"], ["Evento", "event"], ["Pagina", "page"], ["Origem", "source"], ["Dispositivo", "device"], ["Navegador", "browser"], ["Sessao", "session"]]);
      document.getElementById("applyAnalyticsFilters").onclick = () => carregarRelatorioAdmin("analytics");
    }
  } catch (error) { target.innerHTML = `<p>${esc(error.message)}</p>`; }
}

function esc(texto) {
  return String(texto || "")
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

async function iniciarPainelAdmin() {
  try {
    const response = await fetch("/api/admin/session", { cache: "no-store" });
    if (!response.ok) throw new Error("Sessão encerrada.");
    const session = await response.json();
    adminCsrfToken = session.csrfToken;
    adminRole = session.admin?.role || "analyst";
    estado = await window.carregarLojaRemota();
    renderPainel();
  } catch {
    renderLogin();
  }
}

iniciarPainelAdmin();
