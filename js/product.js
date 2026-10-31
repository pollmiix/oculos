const STORAGE_CARRINHO = "mineironet_carrinho";
let loja = window.carregarLojaConfigurada();
const params = new URLSearchParams(window.location.search);
let produto = loja.produtos.find((item) => item.id === params.get("id"));

const $ = (seletor) => document.querySelector(seletor);

function dinheiro(valor) {
  return Number(valor).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function produtoTemPreco(item) {
  return Boolean(item)
    && typeof item.preco === "number"
    && Number.isFinite(item.preco)
    && item.preco > 0;
}

function montarEspecificacoesProduto() {
  const specs = $("#productSpecs");
  specs.replaceChildren();
  const especificacoes = [
    ["SKU", produto.sku],
    ["Cor da armação", produto.corArmacao],
    ["Lente", produto.lente],
    ["Tamanho", produto.tamanho],
    ["Público indicado", produto.publico && produto.publico !== "Não informado" ? produto.publico : ""]
  ].filter(([, valor]) => typeof valor === "string" && valor.trim());
  especificacoes.forEach(([titulo, valor]) => {
    const dt = document.createElement("dt");
    const dd = document.createElement("dd");
    dt.textContent = titulo;
    dd.textContent = valor;
    specs.append(dt, dd);
  });
  specs.hidden = especificacoes.length === 0;

  const referencia = $("#productPriceReference");
  $("#productPixNote").classList.toggle("has-pix-discount", produtoTemPreco(produto) && window.temDescontoPix(produto));
  if (produtoTemPreco(produto)) {
    referencia.textContent = "Frete grátis para todo o Brasil. Entrega em até 7 dias úteis após a confirmação do pagamento.";
    referencia.hidden = false;
    $("#productPixNote").textContent = window.temDescontoPix(produto)
      ? `${window.percentualDescontoPixProduto(produto)}% de desconto aplicado para pagamento via Pix.`
      : "O método de pagamento disponível será exibido no checkout.";
  } else if (produto.paginaOrigem) {
    referencia.textContent = "O catálogo não informa um preço para este produto no momento.";
    referencia.hidden = false;
    $("#productPixNote").textContent = "O valor final só será cobrado depois que o preço e o estoque forem confirmados.";
  } else {
    referencia.hidden = true;
  }

}

function lerCarrinho() {
  return window.lerCarrinhoLoja();
}

function atualizarSubtotal() {
  const limite = Math.max(1, Number(produto.estoque) || 1);
  const quantidade = Math.min(limite, Math.max(1, Math.trunc(Number($("#productQuantity").value)) || 1));
  $("#productQuantity").value = String(quantidade);
  $("#productSubtotal").textContent = produtoTemPreco(produto)
    ? dinheiro(window.precoComDescontoPix(produto) * quantidade)
    : "Consulte o preço";
}

function selecionarImagem(imagem, indice, total) {
  const principal = $("#productMainImage");
  principal.src = imagem;
  principal.alt = `Foto ${indice + 1} de ${total} · ${produto.nome}`;
  $("#productThumbnails").querySelectorAll("button").forEach((botao, posicao) => {
    const ativa = posicao === indice;
    botao.classList.toggle("ativa", ativa);
    botao.setAttribute("aria-pressed", String(ativa));
  });
}

function renderizarGaleria() {
  const fotos = [produto.imagem, ...(Array.isArray(produto.imagens) ? produto.imagens : [])]
    .filter((foto, indice, todas) => typeof foto === "string" && foto.trim() && todas.indexOf(foto) === indice);
  const miniaturas = $("#productThumbnails");
  miniaturas.replaceChildren();

  $("#productMainImage").src = fotos[0] || produto.imagem;
  $("#productMainImage").alt = `Foto principal · ${produto.nome}`;
  miniaturas.hidden = fotos.length < 2;

  fotos.forEach((foto, indice) => {
    const botao = document.createElement("button");
    const imagem = document.createElement("img");
    botao.type = "button";
    botao.className = `product-thumbnail${indice === 0 ? " ativa" : ""}`;
    botao.setAttribute("aria-label", `Ver foto ${indice + 1} de ${fotos.length}`);
    botao.setAttribute("aria-pressed", String(indice === 0));
    imagem.loading = "lazy";
    imagem.decoding = "async";
    imagem.fetchPriority = "low";
    imagem.src = foto;
    imagem.alt = "";
    botao.append(imagem);
    botao.addEventListener("click", () => selecionarImagem(foto, indice, fotos.length));
    miniaturas.append(botao);
  });
}

function configurarVideoProduto() {
  const container = $("#productDemoVideo");
  const video = $("#productDemoVideoPlayer");
  const produtoMeta = /ray[\s-]*ban\s+meta/i.test(String(produto.nome));
  container.hidden = !produtoMeta;
  if (!produtoMeta) return;
  window.iniciarVideoLoja(video, { container });
}

function renderizarProdutosRelacionados() {
  const relacionados = loja.produtos
    .filter((item) => item.categoria === produto.categoria && item.id !== produto.id)
    .slice(0, 4);
  const secao = $("#relatedProductsSection");
  const grade = $("#relatedProductsGrid");
  grade.replaceChildren();
  secao.hidden = relacionados.length === 0;

  relacionados.forEach((item) => {
    const cartao = document.createElement("article");
    const link = document.createElement("a");
    const imagem = document.createElement("img");
    const categoria = document.createElement("span");
    const nome = document.createElement("strong");
    const preco = document.createElement("span");

    cartao.className = "related-product-card";
    link.className = "related-product-link";
    link.href = `produto.html?id=${encodeURIComponent(item.id)}`;
    imagem.src = item.imagem;
    imagem.alt = item.nome;
    imagem.loading = "lazy";
    imagem.decoding = "async";
    categoria.className = "related-product-category";
    categoria.textContent = item.categoria;
    nome.className = "related-product-name";
    nome.textContent = item.nome;
    preco.className = "related-product-price";
    preco.textContent = produtoTemPreco(item) ? dinheiro(window.precoComDescontoPix(item)) : "Consulte o preço";

    link.append(imagem, categoria, nome, preco);
    cartao.append(link);
    grade.append(cartao);
  });
}

function renderizarProduto() {
  const nomeLoja = loja.loja.nome;
  $("#productStoreName").textContent = nomeLoja;
  $("#productFooterName").textContent = nomeLoja;
  const marcaVemari = loja.loja.logo === "imagens/vemari-logo.png";
  document.body.classList.toggle("vemari-brand", marcaVemari);
  $("#productLogo").src = marcaVemari
    ? "imagens/vemari-logo-branco.png"
    : loja.loja.logo;

  if (!produto) {
    document.title = `Produto não encontrado · ${nomeLoja}`;
    $("#productNotFound").hidden = false;
    return;
  }

  window.registrarProdutoVisitado(produto.id);
  $("#productBreadcrumbName").textContent = produto.nome;
  $("#productCategory").textContent = produto.categoria;
  $("#productBreadcrumbCategory").textContent = produto.categoria;
  $("#productName").textContent = produto.nome;
  $("#productDescription").textContent = produto.descricao;
  const temPreco = produtoTemPreco(produto);
  $("#productPrice").textContent = temPreco ? dinheiro(window.precoComDescontoPix(produto)) : "Consulte o preço";
  $("#productPrice").classList.toggle("preco-consulta", !temPreco);
  const precoOriginal = $("#productOldPrice");
  precoOriginal.textContent = window.temDescontoPix(produto) && temPreco ? dinheiro(produto.preco) : "";
  precoOriginal.hidden = !window.temDescontoPix(produto) || !temPreco;
  montarEspecificacoesProduto();
  $("#productStock").textContent = produto.estoque > 0
    ? `${produto.estoque} unidade(s) disponível(is)`
    : "Disponibilidade a confirmar";
  $("#productStock").classList.toggle("indisponivel", produto.estoque <= 0);
  $("#productQuantity").max = String(Math.max(1, Number(produto.estoque) || 1));
  $("#productQuantity").disabled = produto.estoque <= 0 || !temPreco;
  $("#quantityMinus").disabled = produto.estoque <= 0 || !temPreco;
  $("#quantityPlus").disabled = produto.estoque <= 0 || !temPreco;
  $("#productAddButton").disabled = produto.estoque <= 0 || !temPreco;
  $("#productBuyNowButton").disabled = produto.estoque <= 0 || !temPreco;
  $("#productAddButton").textContent = !temPreco
    ? "Consulte o preço"
    : produto.estoque > 0 ? "Adicionar à sacola" : "Disponibilidade a confirmar";
  $("#productBuyNowButton").textContent = !temPreco
    ? "Consulte o preço"
    : produto.estoque > 0 ? "Comprar produto" : "Disponibilidade a confirmar";
  $("#productStockWarning").hidden = produto.estoque > 0 && temPreco;
  if (!temPreco) $("#productStockWarning").textContent = "O preço deste produto ainda não está disponível para compra.";
  const isEyewear = produto.categoria === "Óculos inteligentes"
    || produto.categoria.startsWith("Armações ")
    || produto.categoria === "Outros óculos de grau";
  $("#productPurchaseCheck").textContent = isEyewear
    ? "Confira cor, lente, tamanho e disponibilidade antes de comprar."
    : "Confira edição, idioma e estado do produto antes de comprar.";

  document.title = `${produto.nome} · ${nomeLoja}`;
  document.querySelector('meta[name="description"]').content = produto.descricao;
  document.querySelector('meta[property="og:title"]').content = document.title;
  document.querySelector('meta[property="og:description"]').content = produto.descricao;
  const urlCanonica = new URL("produto.html", window.location.href);
  urlCanonica.searchParams.set("id", produto.id);
  document.querySelector('link[rel="canonical"]').href = urlCanonica.href;
  const dadosEstruturados = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: produto.nome,
    description: produto.descricao,
    category: produto.categoria,
    image: [produto.imagem, ...(Array.isArray(produto.imagens) ? produto.imagens : [])].filter(Boolean),
    ...(produto.sku ? { sku: produto.sku } : {}),
    ...(produto.marca ? { brand: { "@type": "Brand", name: produto.marca } } : {}),
    ...(produto.gtin ? { gtin: produto.gtin } : {}),
    ...(produto.mpn ? { mpn: produto.mpn } : {}),
    ...(temPreco ? {
      offers: {
        "@type": "Offer",
        url: urlCanonica.href,
        priceCurrency: "BRL",
        price: window.precoComDescontoPix(produto),
        availability: Number(produto.estoque) > 0 ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
        itemCondition: "https://schema.org/NewCondition",
        shippingDetails: {
          "@type": "OfferShippingDetails",
          shippingRate: { "@type": "MonetaryAmount", value: 0, currency: "BRL" },
          shippingDestination: { "@type": "DefinedRegion", addressCountry: "BR" }
        },
        seller: { "@type": "Organization", name: nomeLoja }
      }
    } : {})
  };
  let scriptEstruturado = document.getElementById("productStructuredData");
  if (!scriptEstruturado) {
    scriptEstruturado = document.createElement("script");
    scriptEstruturado.id = "productStructuredData";
    scriptEstruturado.type = "application/ld+json";
    document.head.append(scriptEstruturado);
  }
  scriptEstruturado.textContent = JSON.stringify(dadosEstruturados);
  $("#productPageContent").hidden = false;
  renderizarGaleria();
  configurarVideoProduto();
  renderizarProdutosRelacionados();
  window.storeAnalytics?.track("view_item", { productId: produto.id });
  atualizarSubtotal();

  $("#productQuantity").addEventListener("input", atualizarSubtotal);
  $("#quantityMinus").addEventListener("click", () => {
    $("#productQuantity").value = String(Math.max(1, Number($("#productQuantity").value) - 1));
    atualizarSubtotal();
  });
  $("#quantityPlus").addEventListener("click", () => {
    const maximo = Number(produto.estoque) || 1;
    $("#productQuantity").value = String(Math.min(maximo, Number($("#productQuantity").value) + 1));
    atualizarSubtotal();
  });

  try {
    const carrinho = lerCarrinho();
    const idsProdutosCatalogo = new Set(loja.produtos.map((item) => String(item.id)));
    const carrinhoValido = carrinho.filter((item) => idsProdutosCatalogo.has(String(item.id)));
    if (carrinhoValido.length !== carrinho.length) {
      localStorage.setItem(STORAGE_CARRINHO, JSON.stringify(carrinhoValido));
    }
    $("#productCartCount").textContent = String(carrinhoValido.reduce((total, item) => total + (Number(item.qtd) || 0), 0));
  } catch (erro) {
    $("#productAddButton").disabled = true;
    $("#productBuyNowButton").disabled = true;
    $("#productStockWarning").hidden = false;
    $("#productStockWarning").textContent = `Não foi possível ler o carrinho: ${erro.message}`;
  }

  $("#productAddButton").addEventListener("click", () => adicionarAoCarrinho());
  $("#productBuyNowButton").addEventListener("click", () => { window.storeAnalytics?.track("click_buy", { productId: produto.id }); adicionarAoCarrinho(true); });
}

function adicionarAoCarrinho(comprarAgora = false) {
  if (!produtoTemPreco(produto)) {
    $("#productStockWarning").hidden = false;
    $("#productStockWarning").textContent = "O preço deste produto ainda não está disponível para compra.";
    return;
  }
  let carrinho;
  try {
    carrinho = lerCarrinho();
  } catch (erro) {
    $("#productStockWarning").hidden = false;
    $("#productStockWarning").textContent = `Não foi possível ler o carrinho: ${erro.message}`;
    return;
  }

  const quantidade = Math.max(1, Math.trunc(Number($("#productQuantity").value)) || 1);
  const item = carrinho.find((entrada) => entrada.id === produto.id);
  if (quantidade + (Number(item?.qtd) || 0) > produto.estoque) {
    $("#productStockWarning").hidden = false;
    $("#productStockWarning").textContent = `Há somente ${produto.estoque} unidade(s) disponível(is) deste produto.`;
    return;
  }

  if (item) {
    item.qtd += quantidade;
    item.nome = produto.nome;
    item.preco = window.precoComDescontoPix(produto);
    item.imagem = produto.imagem;
  } else {
    carrinho.push({
      id: produto.id,
      nome: produto.nome,
      preco: window.precoComDescontoPix(produto),
      imagem: produto.imagem,
      qtd: quantidade
    });
  }

  try {
    localStorage.setItem(STORAGE_CARRINHO, JSON.stringify(carrinho));
  } catch (erro) {
    $("#productStockWarning").hidden = false;
    $("#productStockWarning").textContent = `Não foi possível salvar o carrinho: ${erro.message}`;
    return;
  }

  window.storeAnalytics?.track("add_to_cart", { productId: produto.id });

  $("#productCartCount").textContent = String(carrinho.reduce((total, entrada) => total + (Number(entrada.qtd) || 0), 0));
  if (comprarAgora) {
    window.location.href = "index.html?checkout=1";
    return;
  }
  $("#productAddedMessage").textContent = `${quantidade} unidade(s) de ${produto.nome} no carrinho.`;
  $("#productAfterAdd").hidden = false;
  $("#productAfterAdd").scrollIntoView({ behavior: "smooth", block: "nearest" });
}

async function iniciarProduto() {
  loja = await window.carregarLojaRemota();
  produto = loja.produtos.find((item) => item.id === params.get("id"));
  renderizarProduto();
}

iniciarProduto();
