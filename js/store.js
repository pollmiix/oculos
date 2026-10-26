const STORAGE_LOJA = "mineironet_loja";
const STORAGE_CARRINHO = "mineironet_carrinho";
const STORAGE_PEDIDOS = "mineironet_pedidos";

let loja = window.carregarLojaConfigurada();
let carrinho = JSON.parse(localStorage.getItem(STORAGE_CARRINHO) || "[]");
const idsProdutosCatalogo = new Set(loja.produtos.map((produto) => String(produto.id)));
const carrinhoSemProdutosRemovidos = carrinho.filter((item) => idsProdutosCatalogo.has(String(item.id)));
if (carrinhoSemProdutosRemovidos.length !== carrinho.length) {
  carrinho = carrinhoSemProdutosRemovidos;
  localStorage.setItem(STORAGE_CARRINHO, JSON.stringify(carrinho));
}
let categoriaAtiva = "Todos";
let busca = "";
let filtroEstoque = { disponiveis: false, indisponiveis: false };
let filtroPreco = { minimo: 0, maximo: 400 };
let limitePrecoCatalogo = 400;
let filtroAtributos = { modelos: [], cores: [], lentes: [], tamanhos: [] };
let ordenacaoCatalogo = "relevance";
let produtoAberto = null;
let pixPayload = "";
let pedidoAtual = null;
let gatewayConfiguradoNoServidor = false;

function salvarPedidoLocalmente(pedido) {
  const pedidos = JSON.parse(localStorage.getItem(STORAGE_PEDIDOS) || "[]");
  const pedidoSemCpf = { ...pedido, cliente: { ...(pedido.cliente || {}) } };
  delete pedidoSemCpf.cliente.cpf;
  pedidos.unshift(pedidoSemCpf);
  localStorage.setItem(STORAGE_PEDIDOS, JSON.stringify(pedidos));
}

try {
  const pedidosLocais = JSON.parse(localStorage.getItem(STORAGE_PEDIDOS) || "[]");
  if (Array.isArray(pedidosLocais)) {
    const pedidosSemCpf = pedidosLocais.map((pedido) => {
      if (!pedido || typeof pedido !== "object" || !pedido.cliente || typeof pedido.cliente !== "object") return pedido;
      const cliente = { ...pedido.cliente };
      delete cliente.cpf;
      return { ...pedido, cliente };
    });
    localStorage.setItem(STORAGE_PEDIDOS, JSON.stringify(pedidosSemCpf));
  }
} catch {
  // Keep an unreadable local record intact rather than deleting customer data.
}

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

function dinheiro(v) {
  return Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function produtoTemPreco(produto) {
  return Boolean(produto)
    && typeof produto.preco === "number"
    && Number.isFinite(produto.preco)
    && produto.preco > 0;
}

function precoParaExibicao(produto) {
  const precoPix = window.precoComDescontoPix(produto);
  return precoPix === null ? "Consulte o preço" : dinheiro(precoPix);
}

function salvarCarrinho() {
  localStorage.setItem(STORAGE_CARRINHO, JSON.stringify(carrinho));
  atualizarBadge();
}

function atualizarBadge() {
  const qtd = carrinho.reduce((s, i) => s + i.qtd, 0);
  const el = $("#cartCount");
  if (el) el.textContent = qtd;
  const contador = $("#cartItemCount");
  if (contador) contador.textContent = `contém ${qtd} ${qtd === 1 ? "item" : "itens"}`;
}

function produtosFiltrados() {
  const filtrados = loja.produtos.filter((p) => {
    const catOk = categoriaAtiva === "Todos" || p.categoria === categoriaAtiva;
    const texto = `${p.nome} ${p.sku || ""} ${p.categoria} ${p.descricao} ${p.corArmacao || ""} ${p.lente || ""} ${p.tamanho || ""}`
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();
    const buscaOk = texto.includes(busca.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase());
    const disponivel = Number(p.estoque) > 0;
    const estoqueOk = (!filtroEstoque.disponiveis && !filtroEstoque.indisponiveis)
      || (filtroEstoque.disponiveis && disponivel)
      || (filtroEstoque.indisponiveis && !disponivel);
    const precoConhecido = produtoTemPreco(p);
    const preco = window.precoComDescontoPix(p);
    const faixaCompleta = filtroPreco.minimo === 0 && filtroPreco.maximo === limitePrecoCatalogo;
    const precoOk = precoConhecido
      ? preco >= filtroPreco.minimo && preco <= filtroPreco.maximo
      : faixaCompleta;
    const atributosOk = (!filtroAtributos.modelos.length || filtroAtributos.modelos.includes(modeloProduto(p)))
      && (!filtroAtributos.cores.length || filtroAtributos.cores.includes(String(p.corArmacao || "")))
      && (!filtroAtributos.lentes.length || filtroAtributos.lentes.includes(String(p.lente || "")))
      && (!filtroAtributos.tamanhos.length || filtroAtributos.tamanhos.includes(String(p.tamanho || "")));
    return catOk && buscaOk && estoqueOk && precoOk && atributosOk;
  });
  if (ordenacaoCatalogo !== "relevance") filtrados.sort((a, b) => {
    const pa = produtoTemPreco(a) ? window.precoComDescontoPix(a) : null;
    const pb = produtoTemPreco(b) ? window.precoComDescontoPix(b) : null;
    if (pa === null && pb === null) return 0;
    if (pa === null) return 1;
    if (pb === null) return -1;
    return ordenacaoCatalogo === "price-asc" ? pa - pb : pb - pa;
  });
  return filtrados;
}

function modeloProduto(produto) {
  const encontrado = String(produto.nome || "").match(/\b(Wayfarer|Headliner|Skyler)\b/i);
  const familia = encontrado ? encontrado[1][0].toUpperCase() + encontrado[1].slice(1).toLowerCase() : "";
  return familia ? `Ray-Ban Meta ${familia}` : String(produto.nome || "Modelo não informado");
}

function renderizarFiltroAtributo(id, valores) {
  const caixa = document.getElementById(id);
  caixa.replaceChildren();
  [...new Set(valores.filter((valor) => valor !== null && valor !== undefined && String(valor).trim()).map(String))]
    .sort((a, b) => a.localeCompare(b, "pt-BR", { numeric: true }))
    .forEach((valor, indice) => {
      const label = document.createElement("label");
      const input = document.createElement("input");
      const texto = document.createElement("span");
      input.type = "checkbox";
      input.value = valor;
      input.id = `${id}-${indice}`;
      input.dataset.catalogFilter = id;
      texto.textContent = valor;
      label.append(input, texto);
      caixa.append(label);
    });
}

function renderTopo() {
  const marcaVemari = loja.loja.logo === "imagens/vemari-logo.png";
  document.body.classList.toggle("vemari-brand", marcaVemari);
  const logoEmFundoEscuro = marcaVemari ? "imagens/vemari-logo-branco.png" : loja.loja.logo;
  $("#logoImg").src = logoEmFundoEscuro;
  $("#checkoutLogo").src = loja.loja.logo;
  $("#checkoutBrandName").textContent = loja.loja.nome;
  $("#nomeLoja").textContent = loja.loja.nome;
  $("#sloganLoja").textContent = loja.loja.slogan;
  $("#topTelefone").textContent = loja.loja.telefone;
  $("#topHorario").textContent = loja.loja.horario;
  $("#footerLogo").src = logoEmFundoEscuro;
  $("#footerEmail").textContent = loja.loja.email;
  $("#footerEmail").href = `mailto:${encodeURIComponent(loja.loja.email)}`;
  const linkWhatsAppRodape = $("#footerWhatsApp");
  if (linkWhatsAppRodape) linkWhatsAppRodape.href = `https://wa.me/${loja.loja.whatsapp}`;
  $("#footerAddress").textContent = loja.loja.endereco;
  $("#waLink").href = `https://wa.me/${loja.loja.whatsapp}`;
  const linkWhatsAppConfianca = $("#trustWaLink");
  if (linkWhatsAppConfianca) linkWhatsAppConfianca.href = `https://wa.me/${loja.loja.whatsapp}`;
  const linkWhatsAppCarrinho = $("#cartWhatsappLink");
  if (linkWhatsAppCarrinho) linkWhatsAppCarrinho.href = `https://wa.me/${loja.loja.whatsapp}`;
  const linkAjudaPagamento = $("#checkoutPaymentHelpLink");
  if (linkAjudaPagamento) linkAjudaPagamento.href = `https://wa.me/${loja.loja.whatsapp}`;
  const linkAjudaGateway = $("#gatewayHelpLink");
  if (linkAjudaGateway) linkAjudaGateway.href = `https://wa.me/${loja.loja.whatsapp}`;
  document.title = `${loja.loja.nome} · Loja`;
  $("#sobreNome").textContent = loja.loja.razaoSocial;
  $("#sobreEndereco").textContent = loja.loja.endereco;
  $("#sobreEmail").textContent = loja.loja.email;
  $("#rodapeNome").textContent = loja.loja.nome;
  $("#rodapeRazao").textContent = loja.loja.razaoSocial;
}

function renderVitrineDestaque() {
  const produto = loja.produtos.find((item) => item.categoria === "Óculos inteligentes");
  const vitrine = $("#featuredShowcase");
  if (!produto) return;

  const imagem = $("#showcaseImage");
  imagem.src = produto.imagem;
  imagem.alt = produto.nome;
  $("#showcaseTitle").textContent = produto.nome;
  $("#showcaseDescription").textContent = produto.descricao;
  $("#showcaseLink").href = urlProduto(produto.id);
  vitrine.hidden = false;
}

function renderColecoesCatalogo() {
  const colecoes = [
    ["smartCollectionCount", "Óculos inteligentes"],
    ["womenCollectionCount", "Armações femininas"],
    ["menCollectionCount", "Armações masculinas"],
    ["otherCollectionCount", "Outros óculos de grau"]
  ];
  colecoes.forEach(([id, categoria]) => {
    const contador = document.getElementById(id);
    if (!contador) return;
    const quantidade = loja.produtos.filter((produto) => produto.categoria === categoria).length;
    contador.textContent = `${quantidade} ${quantidade === 1 ? "modelo" : "modelos"}`;
  });
  const cartoes = [
    [".collection-card-smart", colecoes[0][1]],
    [".collection-grid > a:nth-child(2)", colecoes[1][1]],
    [".collection-grid > a:nth-child(3)", colecoes[2][1]],
    [".collection-card-unclassified", colecoes[3][1]]
  ];
  cartoes.forEach(([seletor, categoria]) => {
    const cartao = document.querySelector(seletor);
    const produto = loja.produtos.find((item) => item.categoria === categoria && item.imagem);
    if (!cartao || !produto || cartao.querySelector(".collection-card-image")) return;
    const imagem = document.createElement("img");
    imagem.className = "collection-card-image";
    imagem.src = produto.imagem;
    imagem.alt = "";
    imagem.loading = "lazy";
    imagem.decoding = "async";
    cartao.prepend(imagem);
  });
}

function configurarAnimacoesDeEntrada() {
  if (!("IntersectionObserver" in window) || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const observador = new IntersectionObserver((entradas, observer) => {
    entradas.forEach((entrada) => {
      if (!entrada.isIntersecting) return;
      entrada.target.classList.add("is-visible");
      observer.unobserve(entrada.target);
    });
  }, { rootMargin: "0px 0px -8% 0px", threshold: 0.01 });

  document.body.classList.add("motion-ready");
  $$("[data-reveal]").forEach((elemento) => observador.observe(elemento));
}

function configurarNewsletter() {
  const formulario = $("#newsletterForm");
  if (!formulario) return;

  formulario.addEventListener("submit", (event) => {
    event.preventDefault();
    const email = $("#newsletterEmail").value.trim();
    const assunto = encodeURIComponent("Solicitação para receber novidades");
    const mensagem = encodeURIComponent(`Olá! Gostaria de receber novidades da loja.\n\nMeu e-mail: ${email}`);
    $("#newsletterStatus").textContent = "Abrindo seu aplicativo de e-mail para enviar a solicitação.";
    window.location.href = `mailto:${loja.loja.email}?subject=${assunto}&body=${mensagem}`;
  });
}

function renderCategorias() {
  const box = $("#cats");
  if (!box) return;
  box.innerHTML = loja.categorias
    .map(
      (c) =>
        `<button class="chip ${c === categoriaAtiva ? "ativo" : ""}" data-cat="${c}">${c}</button>`
    )
    .join("");
  $$("#cats .chip").forEach((btn) => {
    btn.onclick = () => {
      categoriaAtiva = btn.dataset.cat;
      renderCategorias();
      renderFiltrosCategoria();
      renderProdutos();
    };
  });
}

function renderFiltrosCategoria() {
  const box = $("#filterCategories");
  box.replaceChildren();
  loja.categorias.filter((categoria) => categoria !== "Todos").forEach((categoria, indice) => {
  const label = document.createElement("label");
  const input = document.createElement("input");
  const texto = document.createElement("span");
  input.type = "checkbox";
  input.name = "categoria";
  input.value = categoria;
  input.checked = categoriaAtiva === categoria;
  input.id = `filterCategory${indice}`;
  texto.textContent = categoria;
  label.append(input, texto);
  box.append(label);
  input.addEventListener("change", () => {
    categoriaAtiva = input.checked ? categoria : "Todos";
    renderFiltrosCategoria();
    renderCategorias();
    renderProdutos();
  });
  });
}

function configurarFiltrosCatalogo() {
  renderizarFiltroAtributo("filterModels", loja.produtos.map(modeloProduto));
  renderizarFiltroAtributo("filterColors", loja.produtos.map((produto) => produto.corArmacao));
  renderizarFiltroAtributo("filterLenses", loja.produtos.map((produto) => produto.lente));
  renderizarFiltroAtributo("filterSizes", loja.produtos.map((produto) => produto.tamanho));
  limitePrecoCatalogo = Math.max(
  400,
  ...loja.produtos.map((produto) => Math.ceil(window.precoComDescontoPix(produto) || 0))
  );
  filtroPreco = { minimo: 0, maximo: limitePrecoCatalogo };
  ["filterMinRange", "filterMaxRange", "filterMinPrice", "filterMaxPrice"].forEach((id) => {
  const campo = document.getElementById(id);
  campo.max = String(limitePrecoCatalogo);
  });
  $("#filterMaxRange").value = String(limitePrecoCatalogo);
  $("#filterMaxPrice").value = String(limitePrecoCatalogo);

  const emEstoque = loja.produtos.filter((produto) => Number(produto.estoque) > 0).length;
  $("#inStockCount").textContent = `(${emEstoque})`;
  $("#outOfStockCount").textContent = `(${loja.produtos.length - emEstoque})`;
  renderFiltrosCategoria();

  $("#filterInStock").addEventListener("change", (event) => {
  filtroEstoque.disponiveis = event.target.checked;
  renderProdutos();
  });
  $("#filterOutOfStock").addEventListener("change", (event) => {
  filtroEstoque.indisponiveis = event.target.checked;
  renderProdutos();
  });

  const sincronizarFaixa = (origem) => {
  let minimo = Number($("#filterMinRange").value);
  let maximo = Number($("#filterMaxRange").value);
  if (origem === "min" && minimo > maximo) {
    minimo = maximo;
    $("#filterMinRange").value = String(minimo);
  }
  if (origem === "max" && maximo < minimo) {
    maximo = minimo;
    $("#filterMaxRange").value = String(maximo);
  }
  $("#filterMinPrice").value = String(minimo);
  $("#filterMaxPrice").value = String(maximo);
  };
  $("#filterMinRange").addEventListener("input", () => sincronizarFaixa("min"));
  $("#filterMaxRange").addEventListener("input", () => sincronizarFaixa("max"));
  $("#filterMinPrice").addEventListener("input", (event) => {
  const minimo = Math.max(0, Math.min(limitePrecoCatalogo, Number(event.target.value) || 0));
  $("#filterMinRange").value = String(Math.min(minimo, Number($("#filterMaxRange").value)));
  });
  $("#filterMaxPrice").addEventListener("input", (event) => {
  const maximo = Math.max(0, Math.min(limitePrecoCatalogo, Number(event.target.value) || 0));
  $("#filterMaxRange").value = String(Math.max(maximo, Number($("#filterMinRange").value)));
  });
  $("#applyPriceFilter").addEventListener("click", () => {
  const minimoInformado = Number($("#filterMinPrice").value);
  const maximoInformado = Number($("#filterMaxPrice").value);
  const minimo = Math.max(0, Math.min(limitePrecoCatalogo, Number.isFinite(minimoInformado) ? minimoInformado : 0));
  const maximo = Math.max(minimo, Math.min(limitePrecoCatalogo, Number.isFinite(maximoInformado) ? maximoInformado : limitePrecoCatalogo));
  filtroPreco = { minimo, maximo };
  $("#filterMinPrice").value = String(minimo);
  $("#filterMaxPrice").value = String(maximo);
  $("#filterMinRange").value = String(minimo);
  $("#filterMaxRange").value = String(maximo);
  renderProdutos();
  });
  $("#applyCatalogFilters").addEventListener("click", () => {
    const lerGrupo = (id) => [...document.querySelectorAll(`[data-catalog-filter="${id}"]:checked`)].map((campo) => campo.value);
    filtroAtributos = {
      modelos: lerGrupo("filterModels"),
      cores: lerGrupo("filterColors"),
      lentes: lerGrupo("filterLenses"),
      tamanhos: lerGrupo("filterSizes")
    };
    filtroEstoque.disponiveis = $("#filterInStock").checked;
    filtroEstoque.indisponiveis = $("#filterOutOfStock").checked;
    const minimo = Math.max(0, Number($("#filterMinPrice").value) || 0);
    const maximoInformado = Number($("#filterMaxPrice").value);
    const maximo = Math.max(minimo, Number.isFinite(maximoInformado) ? maximoInformado : limitePrecoCatalogo);
    filtroPreco = { minimo, maximo };
    renderProdutos();
  });
  $("#catalogSort").addEventListener("change", (event) => {
    ordenacaoCatalogo = event.target.value;
    renderProdutos();
  });
}

function renderProdutos() {
  const lista = produtosFiltrados();
  const grid = $("#grid");
  $("#catalogResultCount").textContent = `${lista.length} ${lista.length === 1 ? "produto encontrado" : "produtos encontrados"}`;
  if (!lista.length) {
  grid.innerHTML = `<div class="vazio">Nenhum produto encontrado. Ajuste ou limpe os filtros para ver outros produtos.</div>`;
    return;
  }
  grid.innerHTML = lista
    .map(
      (p) => `
      <article class="card">
        ${p.destaque ? `<span class="badge">Destaque</span>` : ""}
        <div class="card-img" data-id="${p.id}"><img src="${p.imagem}" alt="${p.nome}"></div>
        <div class="card-body">
          <div class="cat">${p.publico && p.publico !== "Não informado" ? `${p.categoria} · ${p.publico}` : p.categoria}</div>
          <h3><a href="${urlProduto(p.id)}" data-product-link="${p.id}">${p.nome}</a></h3>
          <p class="card-specs">${[p.corArmacao, p.lente, p.tamanho ? `Tamanho ${p.tamanho}` : ""].filter(Boolean).join(" · ")}</p>
          <div class="precos">
            <strong class="preco">${precoParaExibicao(p)}</strong>
            ${produtoTemPreco(p) && window.temDescontoPix(p) ? `<del class="preco-original">${dinheiro(p.preco)}</del><span class="preco-pix-label">15% de desconto no Pix</span>` : produtoTemPreco(p) ? `<span class="preco-pix-label">Preço informado</span>` : ""}
          </div>
          <p class="product-stock ${p.estoque > 0 && produtoTemPreco(p) ? "" : "pendente"}">
            ${!produtoTemPreco(p) ? "Preço a confirmar com a loja" : p.estoque > 0 ? `${p.estoque} em estoque` : "Estoque a confirmar"}
          </p>
          <a class="btn btn-ghost" data-details="${p.id}" href="${urlProduto(p.id)}">Ver produto →</a>
          <button class="btn btn-verde" data-add="${p.id}" ${p.estoque > 0 && produtoTemPreco(p) ? "" : "disabled"}>
            ${!produtoTemPreco(p) ? "Consulte o preço" : p.estoque > 0 ? "Adicionar" : "Atualize o estoque"}
          </button>
        </div>
      </article>`
    )
    .join("");

  $$("[data-id]").forEach((el) => {
    el.tabIndex = 0;
    el.setAttribute("role", "link");
    el.setAttribute("aria-label", `Ver detalhes de ${el.querySelector("img")?.alt || "produto"}`);
    el.addEventListener("click", () => window.location.assign(urlProduto(el.dataset.id)));
    el.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        window.location.assign(urlProduto(el.dataset.id));
      }
    });
  });
  $$("[data-add]").forEach((el) =>
    el.addEventListener("click", () => adicionar(el.dataset.add, 1))
  );
}

function renderProdutosRecentes() {
  const secao = $("#recentlyViewedSection");
  const grade = $("#recentlyViewedGrid");
  const recentes = window.listarProdutosRecentes(loja.produtos);
  grade.replaceChildren();
  secao.hidden = recentes.length === 0;

  recentes.forEach((produto) => {
    const cartao = document.createElement("article");
    const link = document.createElement("a");
    const imagem = document.createElement("img");
    const categoria = document.createElement("span");
    const nome = document.createElement("span");
    const preco = document.createElement("strong");

    cartao.className = "recently-viewed-card";
    link.className = "recently-viewed-link";
    link.href = urlProduto(produto.id);
    imagem.src = produto.imagem;
    imagem.alt = produto.nome;
    imagem.loading = "lazy";
    imagem.decoding = "async";
    categoria.className = "recently-viewed-category";
    categoria.textContent = produto.categoria;
    nome.className = "recently-viewed-name";
    nome.textContent = produto.nome;
    preco.className = "recently-viewed-price";
    preco.textContent = produtoTemPreco(produto) ? precoParaExibicao(produto) : "Consulte o preço";

    link.append(imagem, categoria, nome, preco);
    cartao.append(link);
    grade.append(cartao);
  });
}

function urlProduto(id) {
  const url = new URL("produto.html", window.location.href);
  url.searchParams.set("id", id);
  return url.href;
}

function abrirProduto(id) {
  produtoAberto = loja.produtos.find((p) => p.id === id);
  if (!produtoAberto) return;
  const fotos = [produtoAberto.imagem, ...(Array.isArray(produtoAberto.imagens) ? produtoAberto.imagens : [])]
    .filter((foto, index, lista) => typeof foto === "string" && foto.trim() && lista.indexOf(foto) === index);
  const imagemPrincipal = $("#modalImg");
  imagemPrincipal.src = fotos[0] || produtoAberto.imagem;
  imagemPrincipal.alt = `Foto de ${produtoAberto.nome}`;
  $("#modalNome").textContent = produtoAberto.nome;
  $("#modalCategoria").textContent = produtoAberto.categoria;
  $("#modalDesc").textContent = produtoAberto.descricao;
  $("#modalPreco").textContent = precoParaExibicao(produtoAberto);
  $("#modalAntigo").textContent = "";
  $("#modalAntigo").hidden = true;
  $("#modalEstoque").textContent = produtoAberto.estoque > 0
    ? `${produtoAberto.estoque} disponíveis em estoque`
    : "Estoque não informado. Consulte a loja.";
  const botaoAdicionar = $("#addModal");
  const podeComprar = produtoAberto.estoque > 0 && produtoTemPreco(produtoAberto);
  botaoAdicionar.disabled = !podeComprar;
  botaoAdicionar.textContent = !produtoTemPreco(produtoAberto)
    ? "Consulte o preço com a loja"
    : podeComprar ? "Adicionar ao carrinho" : "Atualize o estoque no painel";
  $("#qtdModal").disabled = !podeComprar;
  $("#qtdModal").value = "1";

  const galeria = $("#modalGallery");
  galeria.replaceChildren();
  galeria.hidden = fotos.length < 2;
  fotos.forEach((foto, index) => {
    const miniatura = document.createElement("button");
    const imagem = document.createElement("img");
    miniatura.type = "button";
    miniatura.className = `gallery-thumbnail${index === 0 ? " ativa" : ""}`;
    miniatura.setAttribute("aria-label", `Ver foto ${index + 1} de ${fotos.length}`);
    miniatura.setAttribute("aria-pressed", String(index === 0));
    imagem.src = foto;
    imagem.alt = "";
    miniatura.append(imagem);
    miniatura.addEventListener("click", () => {
      imagemPrincipal.src = foto;
      imagemPrincipal.alt = `Foto ${index + 1} de ${produtoAberto.nome}`;
      galeria.querySelectorAll(".gallery-thumbnail").forEach((item) => {
        item.classList.remove("ativa");
        item.setAttribute("aria-pressed", "false");
      });
      miniatura.classList.add("ativa");
      miniatura.setAttribute("aria-pressed", "true");
    });
    galeria.append(miniatura);
  });
  $("#produtoModal").classList.add("aberto");
  $("#overlay").classList.add("aberto");
}

function adicionar(id, qtd) {
  const prod = loja.produtos.find((p) => p.id === id);
  if (!prod) return;
  const item = carrinho.find((i) => i.id === id);
  const estoque = Number(prod.estoque) || 0;
  if (!produtoTemPreco(prod)) {
    alert("O preço deste produto ainda não foi confirmado. Fale com a loja antes de comprar.");
    return;
  }
  if (estoque <= 0) {
    alert("O estoque deste produto ainda não foi informado. Atualize no painel antes de vender.");
    return;
  }
  if (qtd + (item?.qtd || 0) > estoque) {
    alert(`Há somente ${estoque} unidade(s) deste produto em estoque.`);
    return;
  }
  if (item) item.qtd += qtd;
  else carrinho.push({ id, nome: prod.nome, preco: window.precoComDescontoPix(prod), imagem: prod.imagem, qtd });
  if (item) item.preco = window.precoComDescontoPix(prod);
  window.storeAnalytics?.track("add_to_cart", { productId: prod.id });
  salvarCarrinho();
  renderCarrinho();
  abrirCarrinho();
}

function remover(id) {
  carrinho = carrinho.filter((i) => i.id !== id);
  salvarCarrinho();
  renderCarrinho();
}

function mudarQtd(id, delta) {
  const item = carrinho.find((i) => i.id === id);
  if (!item) return;
  const produto = loja.produtos.find((p) => p.id === id);
  if (delta > 0 && produto && item.qtd + delta > produto.estoque) {
    alert(`Há somente ${produto.estoque} unidade(s) deste produto em estoque.`);
    return;
  }
  item.qtd += delta;
  if (item.qtd <= 0) return remover(id);
  salvarCarrinho();
  renderCarrinho();
}

function totalCarrinho() {
  return carrinho.reduce((s, i) => s + Number(i.preco) * i.qtd, 0);
}

function renderCarrinho() {
  const box = $("#cartItems");
  const botaoCheckout = $("#btnCheckout");
  if (!carrinho.length) {
    box.innerHTML = `
      <div class="cart-empty">
        <span class="cart-empty-icon" aria-hidden="true">🕶️</span>
        <h3>Seu carrinho está vazio</h3>
        <p>Explore os óculos inteligentes disponíveis na loja.</p>
        <button class="btn btn-verde" id="verProdutosCarrinho" type="button">Ver produtos</button>
      </div>`;
    $("#cartSubtotal").textContent = dinheiro(0);
    $("#cartTotal").textContent = dinheiro(0);
    botaoCheckout.disabled = true;
    $("#verProdutosCarrinho").onclick = fecharTudo;
    atualizarBadge();
    return;
  }
  box.innerHTML = carrinho
    .map(
      (i) => `
      <div class="item">
        <a class="cart-item-image" href="produto.html?id=${encodeURIComponent(i.id)}" aria-label="Ver ${i.nome}">
          <img src="${i.imagem}" alt="">
        </a>
        <div class="cart-item-info">
          <a class="cart-item-name" href="produto.html?id=${encodeURIComponent(i.id)}">${i.nome}</a>
          <strong class="cart-item-price">${dinheiro(i.preco)}</strong>
          <div class="qty">
            <button type="button" data-menos="${i.id}" aria-label="Diminuir quantidade de ${i.nome}">−</button>
            <span aria-label="Quantidade">${i.qtd}</span>
            <button type="button" data-mais="${i.id}" aria-label="Aumentar quantidade de ${i.nome}">+</button>
          </div>
          <strong class="cart-item-subtotal">${dinheiro(i.preco * i.qtd)}</strong>
        </div>
        <button class="cart-remove-button" type="button" data-rem="${i.id}" aria-label="Remover ${i.nome} do carrinho">Remover</button>
      </div>`
    )
    .join("");
  $("#cartSubtotal").textContent = dinheiro(totalCarrinho());
  $("#cartTotal").textContent = dinheiro(totalCarrinho());
  botaoCheckout.disabled = false;
  $$("[data-menos]").forEach((b) => b.onclick = () => mudarQtd(b.dataset.menos, -1));
  $$("[data-mais]").forEach((b) => b.onclick = () => mudarQtd(b.dataset.mais, 1));
  $$("[data-rem]").forEach((b) => b.onclick = () => remover(b.dataset.rem));
  atualizarBadge();
}

function abrirCarrinho() {
  $("#cartDrawer").classList.add("aberto");
  $("#overlay").classList.add("aberto");
}
function fecharTudo() {
  $("#cartDrawer").classList.remove("aberto");
  $("#produtoModal").classList.remove("aberto");
  $("#overlay").classList.remove("aberto");
}

function abrirCheckout() {
  if (!carrinho.length) return;
  window.storeAnalytics?.track("begin_checkout");
  fecharTudo();
  $("#checkout").classList.add("aberto");
  const gatewaySelecionado = loja.pagamento.metodo === "gateway";
  $("#checkout").classList.remove("gateway-pendente");
  $("#gatewayPending").hidden = true;
  $("#checkoutPaymentHint").querySelector("span").textContent = "✓";
  $("#checkoutPaymentMessage").textContent = "Confira os produtos e o valor antes de pagar.";
  $("#checkoutPaymentHelpLink").hidden = true;
  $("#checkoutForm").hidden = false;
  $(".checkout-summary-column").hidden = false;
  $("#checkoutTitle").textContent = gatewaySelecionado ? "Checkout BlackCat" : "Checkout PIX";
  $("#checkoutEmail").required = gatewaySelecionado;
  $("#checkoutEmail").closest(".campo").querySelector("label span").textContent = gatewaySelecionado ? "(obrigatório para o gateway)" : "(opcional)";
  $("#cpf").required = gatewaySelecionado;
  $("#cpfRequirement").textContent = gatewaySelecionado ? "(obrigatório para a cobrança)" : "(não é necessário para PIX)";
  $("#btnPix").textContent = gatewaySelecionado ? "Gerar cobrança PIX" : "Gerar PIX";
  const pixConfigurado = window.PixBR?.validarChave(loja.pix.tipo, loja.pix.chave) === true;
  $("#checkoutPaymentHelpLink").hidden = gatewaySelecionado ? gatewayConfiguradoNoServidor : pixConfigurado;
  $("#btnPix").disabled = gatewaySelecionado ? !gatewayConfiguradoNoServidor : !pixConfigurado;
  if (gatewaySelecionado && !gatewayConfiguradoNoServidor) {
    $("#checkout").classList.add("gateway-pendente");
    $("#gatewayPending").hidden = false;
    $("#checkoutForm").hidden = true;
    $(".checkout-summary-column").hidden = true;
  } else if (!gatewaySelecionado && !pixConfigurado) {
    $("#btnPix").textContent = "PIX indisponível no momento";
    $("#checkoutPaymentHint").querySelector("span").textContent = "!";
    $("#checkoutPaymentMessage").textContent = "A loja ainda não configurou a chave PIX. Fale com a equipe para confirmar o pagamento.";
    $("#checkoutPaymentHelpLink").hidden = false;
  }
  $("#checkout").classList.remove("pix-gerado");
  $("#pixBox").classList.remove("visivel");
  $("#checkoutForm").style.display = "block";
  $("#sucesso").classList.remove("visivel");
  renderResumo();
}

function renderResumo() {
  const itens = $("#resumoItens");
  itens.replaceChildren();
  carrinho.forEach((produto) => {
    const linha = document.createElement("div");
    linha.className = "checkout-order-item";
    const imagem = document.createElement("img");
    imagem.src = produto.imagem || "imagens/produtos/oculos-inteligentes.svg";
    imagem.alt = "";
    imagem.loading = "lazy";
    const detalhes = document.createElement("div");
    detalhes.className = "checkout-order-details";
    const nome = document.createElement("strong");
    nome.textContent = produto.nome;
    const quantidade = document.createElement("span");
    quantidade.textContent = `${produto.qtd} ${produto.qtd === 1 ? "unidade" : "unidades"} × ${dinheiro(produto.preco)}`;
    const subtotal = document.createElement("strong");
    subtotal.className = "checkout-order-subtotal";
    subtotal.textContent = dinheiro(produto.preco * produto.qtd);
    detalhes.append(nome, quantidade);
    linha.append(imagem, detalhes, subtotal);
    itens.append(linha);
  });
  const total = totalCarrinho();
  const quantidadeTotal = carrinho.reduce((soma, item) => soma + item.qtd, 0);
  $("#resumoQtd").textContent = `${quantidadeTotal} ${quantidadeTotal === 1 ? "item" : "itens"}`;
  $("#resumoSubtotal").textContent = dinheiro(total);
  $("#resumoTotal").textContent = dinheiro(total);
}

function mascara(el, tipo) {
  el.addEventListener("input", () => {
    let v = el.value.replace(/\D/g, "");
    if (tipo === "cpf") {
      v = v.replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d{1,2})$/, "$1-$2");
    }
    if (tipo === "tel") {
      v = v.replace(/(\d{2})(\d)/, "($1) $2").replace(/(\d{5})(\d)/, "$1-$2");
    }
    if (tipo === "cep") v = v.replace(/(\d{5})(\d)/, "$1-$2");
    el.value = v;
  });
}

async function buscarCep() {
  const cep = $("#cep").value.replace(/\D/g, "");
  if (cep.length !== 8) return;
  const r = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
  const d = await r.json();
  if (d.erro) return;
  $("#rua").value = d.logradouro || "";
  $("#bairro").value = d.bairro || "";
  $("#cidade").value = d.localidade || "";
  $("#uf").value = d.uf || "";
}

function txidPedido() {
  const randomId = Array.from(crypto.getRandomValues(new Uint8Array(10)), (byte) => byte.toString(16).padStart(2, "0")).join("").toUpperCase();
  return `MN${randomId}`;
}

async function gerarPix() {
  const form = new FormData($("#checkoutForm"));
  const dados = Object.fromEntries(form.entries());
  if (!dados.nome || (loja.pagamento.metodo === "gateway" && !dados.cpf) || !dados.telefone || !dados.cep) {
    alert(loja.pagamento.metodo === "gateway"
      ? "Preencha nome, CPF, telefone e CEP para gerar a cobrança."
      : "Preencha nome, telefone e CEP para gerar o PIX.");
    return;
  }
  if (loja.pagamento.metodo === "gateway") {
    gerarCobrancaBlackCat(dados);
    return;
  }
  if (!window.PixBR.validarChave(loja.pix.tipo, loja.pix.chave)) {
    alert("A loja ainda não configurou uma chave PIX válida. Entre em contato pelo WhatsApp.");
    return;
  }
  const txid = txidPedido();
  pixPayload = window.PixBR.gerarPayload({
    chave: loja.pix.chave,
    nomeRecebedor: loja.pix.nomeRecebedor,
    cidade: loja.pix.cidade,
    valor: totalCarrinho(),
    txid
  });
  pedidoAtual = {
    id: txid,
    cliente: dados,
    itens: carrinho,
    total: totalCarrinho(),
    pix: pixPayload,
    status: "aguardando_pagamento",
    criadoEm: new Date().toISOString()
  };
  const botao = $("#btnPix");
  botao.disabled = true;
  botao.textContent = "Registrando pedido...";
  try {
    const response = await fetch("/api/orders/manual", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        orderId: txid,
        pixPayload,
        customer: { name: dados.nome, email: dados.email, phone: dados.telefone },
        shipping: { street: dados.rua, number: dados.numero, complement: dados.obs, neighborhood: dados.bairro, city: dados.cidade, state: dados.uf, zipCode: dados.cep },
        items: carrinho.map((item) => ({ id: item.id, quantity: item.qtd })),
        analyticsSessionId: window.storeAnalytics?.sessionId() || ""
      })
    });
    const result = await response.json();
    if (!response.ok || !result.success || result.orderId !== txid) {
      throw new Error(result.error || "Não foi possível registrar o pedido.");
    }
    pedidoAtual.status = result.paymentStatus || "pending";
  } catch (error) {
    pedidoAtual = null;
    pixPayload = "";
    alert(`Não foi possível registrar o pedido no servidor: ${error.message}. Verifique a conexão e tente novamente.`);
    return;
  } finally {
    botao.disabled = false;
    botao.textContent = loja.pagamento.metodo === "gateway" ? "Gerar cobrança PIX" : "Gerar PIX";
  }
  $("#pixCode").textContent = pixPayload;
  $("#checkoutForm").style.display = "none";
  $("#pixBox").classList.add("visivel");
  $("#checkout").classList.add("pix-gerado");
  $("#checkoutTitle").textContent = "Pagamento PIX";
  const statusQr = $("#pixQrStatus");
  try {
    if (typeof window.qrcode !== "function") {
      throw new Error("A biblioteca geradora de QR Code não foi carregada.");
    }
    const qr = window.qrcode(0, "M");
    qr.addData(pixPayload, "Byte");
    qr.make();
    $("#pixQr").src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(qr.createSvgTag(8, 4, "QR Code PIX"))}`;
    statusQr.textContent = "";
  } catch (erro) {
    console.error("Não foi possível gerar o QR Code PIX.", erro);
    statusQr.textContent = "QR Code indisponível. Use o código PIX Copia e Cola abaixo.";
  }
  $("#pixValor").textContent = dinheiro(totalCarrinho());
}

async function gerarCobrancaBlackCat(dados) {
  const botao = $("#btnPix");
  botao.disabled = true;
  botao.textContent = "Criando cobrança segura...";
  try {
    const response = await fetch("/api/payments/blackcat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        customer: {
          name: dados.nome,
          email: dados.email,
          phone: dados.telefone,
          document: { number: dados.cpf, type: "cpf" }
        },
        shipping: {
          street: dados.rua,
          number: dados.numero,
          complement: dados.obs,
          neighborhood: dados.bairro,
          city: dados.cidade,
          state: dados.uf,
          zipCode: dados.cep
        },
        items: carrinho.map((item) => ({ id: item.id, quantity: item.qtd })),
        analyticsSessionId: window.storeAnalytics?.sessionId() || ""
      })
    });
    const result = await response.json();
    if (!response.ok || !result.success || !result.data) {
      throw new Error(result.error || "O servidor não conseguiu criar a cobrança BlackCat.");
    }
    const charge = result.data;
    const payment = charge.paymentData || {};
    const total = totalCarrinho();
    if (!charge.transactionId || Number(charge.amount) !== Math.round(total * 100)) {
      throw new Error("Os dados da cobrança não correspondem ao total do pedido. Não pague e fale com a loja.");
    }
    pixPayload = String(payment.copyPaste || payment.qrCode || "");
    pedidoAtual = {
      id: String(charge.transactionId),
      transactionId: String(charge.transactionId),
      gateway: "blackcat",
      cliente: dados,
      itens: carrinho.map((item) => ({ ...item })),
      total,
      pix: pixPayload,
      status: charge.status || "PENDING",
      criadoEm: new Date().toISOString()
    };
    $("#pixCode").textContent = pixPayload;
    $("#pixValor").textContent = dinheiro(total);
    $("#pixBox").classList.add("visivel");
    $("#checkoutForm").style.display = "none";
    $("#checkout").classList.add("pix-gerado");
    $("#checkoutTitle").textContent = "Pagamento BlackCat";
    $(".pix-payment-heading h3").textContent = "Cobrança PIX pronta";
    $(".pix-payment-heading p").textContent = "Escaneie o QR Code gerado pela BlackCat para pagar.";
    $(".pix-confirm-note").textContent = "O status será confirmado diretamente com a BlackCat antes de registrar o pedido como pago.";
    $("#btnPago").textContent = "Verificar pagamento";
    const imagemQr = $("#pixQr");
    const statusQr = $("#pixQrStatus");
    const imagemBase64 = payment.qrCodeBase64;
    if (typeof imagemBase64 === "string" && imagemBase64) {
      imagemQr.src = imagemBase64.startsWith("data:image/")
        ? imagemBase64
        : `data:image/png;base64,${imagemBase64}`;
      statusQr.textContent = "";
    } else if (pixPayload && typeof window.qrcode === "function") {
      const qr = window.qrcode(0, "M");
      qr.addData(pixPayload, "Byte");
      qr.make();
      imagemQr.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(qr.createSvgTag(8, 4, "QR Code PIX BlackCat"))}`;
      statusQr.textContent = "";
    } else {
      imagemQr.removeAttribute("src");
      statusQr.textContent = "A BlackCat não forneceu a imagem do QR. Use a página de pagamento ou o código Copia e Cola.";
    }
    const detalhesPix = $(".pix-code-details");
    detalhesPix.hidden = !pixPayload;
    $("#btnCopiar").disabled = !pixPayload;
    const linkFatura = $("#pixInvoiceLink");
    if (typeof charge.invoiceUrl === "string" && charge.invoiceUrl.startsWith("https://")) {
      linkFatura.href = charge.invoiceUrl;
      linkFatura.hidden = false;
    } else {
      linkFatura.hidden = true;
    }
    const statusPagamento = $("#gatewayPaymentStatus");
    statusPagamento.hidden = false;
    statusPagamento.textContent = "Aguardando confirmação do pagamento pela BlackCat.";
  } catch (erro) {
    alert(`Não foi possível criar o PIX BlackCat: ${erro.message}`);
  } finally {
    botao.disabled = false;
    botao.textContent = "Gerar cobrança PIX";
  }
}

async function copiarPix() {
  try {
    await navigator.clipboard.writeText(pixPayload);
    $("#btnCopiar").textContent = "Código copiado";
    setTimeout(() => ($("#btnCopiar").textContent = "Copiar código PIX"), 1600);
  } catch {
    alert("Não foi possível copiar. Selecione o código manualmente.");
  }
}

async function confirmarPagamento() {
  if (!pedidoAtual) {
    alert("Gere o PIX antes de confirmar.");
    return;
  }
  if (pedidoAtual.gateway === "blackcat") {
    const botao = $("#btnPago");
    const statusPagamento = $("#gatewayPaymentStatus");
    botao.disabled = true;
    statusPagamento.hidden = false;
    statusPagamento.textContent = "Consultando a BlackCat...";
    try {
      const response = await fetch(`/api/payments/${encodeURIComponent(pedidoAtual.transactionId)}`, { cache: "no-store" });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || "Não foi possível consultar o pagamento.");
      if (result.data.status !== "PAID" || Number(result.data.amount) !== Math.round(pedidoAtual.total * 100)) {
        statusPagamento.textContent = result.data.status === "CANCELLED" || result.data.status === "REFUNDED"
          ? "A cobrança foi cancelada ou estornada. Gere uma nova cobrança ou fale com a loja."
          : "Pagamento ainda pendente. Aguarde a confirmação do banco e tente novamente.";
        return;
      }
      pedidoAtual.status = "PAID";
    } catch (erro) {
      statusPagamento.textContent = `Não foi possível confirmar agora: ${erro.message}`;
      return;
    } finally {
      botao.disabled = false;
    }
  } else {
    try {
      const response = await fetch(`/api/orders/manual/${encodeURIComponent(pedidoAtual.id)}/report`, {
        method: "POST",
        cache: "no-store"
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || "Não foi possível informar o pagamento.");
      pedidoAtual.status = "pago_informado";
    } catch (error) {
      alert(`Não foi possível informar o pagamento: ${error.message}. Tente novamente.`);
      return;
    }
  }
  salvarPedidoLocalmente(pedidoAtual);
  $("#checkoutForm").style.display = "none";
  $("#pixBox").classList.remove("visivel");
  $("#sucesso").classList.add("visivel");
  $("#pedidoId").textContent = pedidoAtual.id;
  const texto = encodeURIComponent(
    [
      `Olá! Informo o pagamento PIX do pedido ${pedidoAtual.id}.`,
      "",
      "Produtos:",
      ...pedidoAtual.itens.map((item) => `• ${item.qtd}x ${item.nome} — ${dinheiro(item.preco * item.qtd)}`),
      "",
      "Endereço para envio:",
      pedidoAtual.cliente.nome,
      `${pedidoAtual.cliente.rua}, ${pedidoAtual.cliente.numero}`,
      pedidoAtual.cliente.obs ? `Complemento/referência: ${pedidoAtual.cliente.obs}` : "",
      `${pedidoAtual.cliente.bairro} — ${pedidoAtual.cliente.cidade}/${pedidoAtual.cliente.uf}`,
      `CEP: ${pedidoAtual.cliente.cep}`,
      "",
      `Total dos produtos: ${dinheiro(pedidoAtual.total)}.`,
      "Frete grátis para todo o Brasil. Entrega em até 7 dias úteis após a confirmação do pagamento."
    ].filter(Boolean).join("\n")
  );
  $("#waPedido").href = `https://wa.me/${loja.loja.whatsapp}?text=${texto}`;
  carrinho = [];
  salvarCarrinho();
  renderCarrinho();
}

async function iniciar() {
  const saudePendente = fetch("/api/health", { cache: "no-store" })
    .then((response) => response.ok ? response.json() : {})
    .catch(() => ({}));
  loja = await window.carregarLojaRemota();
  const videoCapa = $(".hero-video");
  if (videoCapa) {
    videoCapa.muted = true;
    videoCapa.defaultMuted = true;
    videoCapa.playsInline = true;
    videoCapa.autoplay = true;
    const reproduzirVideoCapa = () => {
      if (document.visibilityState !== "visible") return;
      videoCapa.play().catch((erro) => {
        if (erro.name !== "AbortError") {
          console.error("Não foi possível iniciar automaticamente o vídeo da capa.", erro);
        }
      });
    };
    videoCapa.addEventListener("canplay", reproduzirVideoCapa);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") reproduzirVideoCapa();
      else videoCapa.pause();
    });
    reproduzirVideoCapa();
  }
  if (window.matchMedia("(max-width: 760px)").matches) {
    $("#filterModels").closest("details").open = false;
  }
  gatewayConfiguradoNoServidor = (await saudePendente).paymentConfigured === true;
  carrinho = carrinho.map((item) => {
    const produto = loja.produtos.find((candidato) => candidato.id === item.id);
    return produtoTemPreco(produto)
      ? { ...item, nome: produto.nome, preco: window.precoComDescontoPix(produto), imagem: produto.imagem }
      : item;
  });
  salvarCarrinho();
  renderTopo();
  renderVitrineDestaque();
  renderColecoesCatalogo();
  renderCategorias();
  configurarFiltrosCatalogo();
  renderProdutos();
  renderProdutosRecentes();
  renderCarrinho();
  atualizarBadge();
  configurarAnimacoesDeEntrada();
  configurarNewsletter();
  const menuToggle = $("#menuToggle");
  const categoryNav = $("#primaryNav");
  const fecharMenu = () => {
    categoryNav.classList.remove("menu-open");
    menuToggle.setAttribute("aria-expanded", "false");
    menuToggle.setAttribute("aria-label", "Abrir menu");
  };
  menuToggle.addEventListener("click", () => {
    const aberto = menuToggle.getAttribute("aria-expanded") !== "true";
    menuToggle.setAttribute("aria-expanded", String(aberto));
    menuToggle.setAttribute("aria-label", aberto ? "Fechar menu" : "Abrir menu");
    categoryNav.classList.toggle("menu-open", aberto);
  });
  categoryNav.addEventListener("click", (event) => {
    if (event.target.closest("a")) fecharMenu();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") fecharMenu();
  });
  document.addEventListener("pointerdown", (event) => {
    if (!categoryNav.contains(event.target) && !menuToggle.contains(event.target)) fecharMenu();
  });
  window.addEventListener("resize", () => {
    if (window.innerWidth > 680) fecharMenu();
  });
  $$("[data-category-link]").forEach((link) => {
    link.addEventListener("click", () => {
      categoriaAtiva = link.dataset.categoryLink;
      renderFiltrosCategoria();
      renderProdutos();
    });
  });
  mascara($("#cpf"), "cpf");
  mascara($("#telefone"), "tel");
  mascara($("#cep"), "cep");
  $("#cep").addEventListener("blur", buscarCep);
  $("#busca").addEventListener("input", (e) => {
    busca = e.target.value;
    $("#filterSearchInput").value = busca;
    renderProdutos();
  });
  $("#filterSearchInput").addEventListener("input", (event) => {
    busca = event.target.value;
    $("#busca").value = busca;
    renderProdutos();
  });
  $("#headerSearchForm").addEventListener("submit", (event) => {
    event.preventDefault();
    document.querySelector("#grid").scrollIntoView({ behavior: "smooth", block: "start" });
  });
  $("#filterSearchForm").addEventListener("submit", (event) => {
    event.preventDefault();
    busca = $("#filterSearchInput").value;
    $("#busca").value = busca;
    renderProdutos();
  });
  $("#resetCatalogFilters").addEventListener("click", () => {
    busca = "";
    categoriaAtiva = "Todos";
    filtroEstoque = { disponiveis: false, indisponiveis: false };
    filtroPreco = { minimo: 0, maximo: limitePrecoCatalogo };
    filtroAtributos = { modelos: [], cores: [], lentes: [], tamanhos: [] };
    ordenacaoCatalogo = "relevance";
    $("#catalogSort").value = "relevance";
    document.querySelectorAll("[data-catalog-filter]").forEach((campo) => { campo.checked = false; });
    $("#busca").value = "";
    $("#filterSearchInput").value = "";
    $("#filterInStock").checked = false;
    $("#filterOutOfStock").checked = false;
    $("#filterMinPrice").value = "0";
    $("#filterMaxPrice").value = String(limitePrecoCatalogo);
    $("#filterMinRange").value = "0";
    $("#filterMaxRange").value = String(limitePrecoCatalogo);
    renderCategorias();
    renderFiltrosCategoria();
    renderProdutos();
  });
  $("#btnCart").onclick = abrirCarrinho;
  $("#fecharCart").onclick = fecharTudo;
  $("#continuarComprando").onclick = fecharTudo;
  $("#overlay").onclick = fecharTudo;
  $("#fecharModal").onclick = fecharTudo;
  $("#addModal").onclick = () => {
    if (produtoAberto) {
      const id = produtoAberto.id;
      const quantidade = Math.max(1, Number($("#qtdModal").value) || 1);
      fecharTudo();
      adicionar(id, quantidade);
    }
  };
  $("#btnCheckout").onclick = abrirCheckout;
  $("#fecharCheckout").onclick = () => {
    $("#checkout").classList.remove("aberto", "pix-gerado", "gateway-pendente");
    $("#gatewayPending").hidden = true;
    $(".checkout-summary-column").hidden = false;
    $("#checkoutForm").hidden = false;
    $("#checkoutTitle").textContent = "Checkout PIX";
  };
  $("#gatewayBackButton").onclick = () => {
    $("#checkout").classList.remove("aberto", "gateway-pendente");
    $("#gatewayPending").hidden = true;
    $(".checkout-summary-column").hidden = false;
    $("#checkoutForm").hidden = false;
  };
  $("#btnVoltarCheckout").onclick = () => {
    $("#checkout").classList.remove("pix-gerado");
    $("#checkoutForm").style.display = "block";
    $("#checkoutTitle").textContent = "Checkout PIX";
  };
  $("#btnPix").onclick = () => {
    if ($("#checkoutForm").reportValidity()) gerarPix();
  };
  $("#btnCopiar").onclick = copiarPix;
  $("#btnPago").onclick = confirmarPagamento;
  const parametrosDaPagina = new URLSearchParams(window.location.search);
  if (parametrosDaPagina.get("checkout") === "1") {
    abrirCheckout();
  } else if (parametrosDaPagina.get("carrinho") === "1") {
    abrirCarrinho();
  }
}

document.addEventListener("DOMContentLoaded", iniciar);
