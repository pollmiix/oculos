const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const remoteProduct = {
  id: 'remote-only-product', nome: 'Produto publicado', categoria: 'Óculos inteligentes',
  preco: 100, estoque: 2, imagem: 'https://example.com/product.jpg'
};
let remoteProducts = [remoteProduct];
let savedStore = null;
const context = {
  structuredClone, URL,
  console: { error() {} },
  localStorage: { getItem() { return savedStore; }, setItem(key, value) { savedStore = value; } },
  location: { protocol: 'https:' },
  fetch: async () => ({
    ok: true, status: 200,
    json: async () => ({ loja: {}, pix: {}, pagamento: {}, categorias: ['Todos', 'Óculos inteligentes'], produtos: structuredClone(remoteProducts) })
  })
};
context.window = context;
vm.createContext(context);
for (const script of ['catalogo-coliseu.js', 'catalogo-painel-recuperado.js']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../js', script), 'utf8'), context);
}
vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/config.js'), 'utf8'), context);

(async () => {
  const catalog = await context.carregarLojaRemota();
  assert.equal(catalog.produtos.length, 1, 'Removed/unpublished products must not be reimported.');
  assert.equal(catalog.produtos[0].id, remoteProduct.id);
  assert.equal(catalog.produtos[0].estoque, 2, 'Remote inventory must not be replaced by default stock.');
  assert.equal(catalog.produtos[0].preco, 100, 'Remote price must remain unchanged.');

  remoteProducts = [];
  const empty = await context.carregarLojaRemota();
  assert.equal(empty.produtos.length, 0, 'An empty published catalog must remain empty.');

  context.fetch = async () => { throw new Error('Offline'); };
  const offline = await context.carregarLojaRemota();
  assert.equal(offline.produtos.length, 0, 'A server outage must not offer sample products for sale.');

  for (const hostname of ['localhost', '127.0.0.1', '[::1]']) {
    context.location.hostname = hostname;
    const preview = await context.carregarLojaRemota();
    assert.ok(preview.produtos.length > 0, 'A local preview must display the bundled catalog when the API is unavailable.');
    assert.ok(preview.produtos.every(item => item.estoque === 0), 'Preview products must not offer unconfirmed stock for sale.');
  }

  context.fetch = async () => ({ ok: false, status: 404 });
  const unsyncedPreview = await context.carregarLojaRemota();
  assert.ok(unsyncedPreview.produtos.length > 0, 'An unsynced local server must still display the preview.');

  remoteProducts = [];
  context.fetch = async () => ({ ok: true, status: 200, json: async () => ({ produtos: remoteProducts }) });
  const publishedEmptyPreview = await context.carregarLojaRemota();
  assert.equal(publishedEmptyPreview.produtos.length, 0, 'Local preview must respect a successfully loaded empty published catalog.');

  context.location.hostname = 'loja.example.com';
  context.fetch = async () => ({ ok: false, status: 404 });
  const unsyncedProduction = await context.carregarLojaRemota();
  assert.equal(unsyncedProduction.produtos.length, 0, 'Production must not restore bundled products when the API returns 404.');

  const oldCatalog = context.aplicarProdutosComplementares({ produtos: [structuredClone(remoteProduct)], categorias: ['Todos'] });
  assert.equal(oldCatalog.produtos.find(item => item.id === remoteProduct.id).estoque, 2, 'Legacy migration must preserve manually entered stock.');

  savedStore = JSON.stringify({
    produtos: [{ ...remoteProduct, preco: 100, antigo: 150, precoPix: 90, precoPromocional: 95 }],
    categorias: ['Todos']
  });
  for (let reload = 0; reload < 2; reload++) {
    const savedProduct = context.carregarLojaConfigurada().produtos.find(item => item.id === remoteProduct.id);
    assert.equal(savedProduct.preco, 48, 'Saved prices must receive both reductions exactly once.');
    assert.equal(savedProduct.antigo, 72, 'Original prices must also receive both reductions.');
    assert.equal(savedProduct.precoPix, 43.2);
    assert.equal(savedProduct.precoPromocional, 45.6);
    assert.equal(savedProduct.estoque, 2, 'Price changes must preserve stock.');
  }
  savedStore = JSON.stringify({ versaoReducaoPrecos: 1, categorias: ['Todos'], produtos: [{ ...remoteProduct, antigo: 150 }] });
  for (let reload = 0; reload < 2; reload++) {
    const product = context.carregarLojaConfigurada().produtos.find(item => item.id === remoteProduct.id);
    assert.equal(product.preco, 80, 'Previously reduced prices must receive only the extra 20%, once.');
    assert.equal(product.antigo, 120);
  }
  console.log('Published catalog authority tests passed.');
  const smartPrices = JSON.parse(fs.readFileSync(path.join(__dirname, '../smart-product-prices.json'), 'utf8'));
  const smartDefaults = context.LOJA_PADRAO.produtos.filter(p => p.categoria === 'Óculos inteligentes');
  assert.equal(smartDefaults.length, 16);
  for (const product of smartDefaults) {
    assert.equal(product.preco, smartPrices[product.id]);
    assert.equal(context.precoComDescontoPix(product), Math.round(smartPrices[product.id] * 90) / 100, 'Displayed Pix prices must be 10% below the base prices.');
    assert.equal(product.precoPix, context.precoComDescontoPix(product));
  }
  savedStore = JSON.stringify({ versaoReducaoPrecos: 2, versaoPrecosInteligentes: 1, versaoDescontoPixInteligentes: 1, categorias: ['Todos'], produtos: smartDefaults.map(p => ({ ...p, preco: 999, precoPix: 999, aplicarDescontoPix: true })) });
  for (let reload = 0; reload < 2; reload++) {
    const smart = context.carregarLojaConfigurada().produtos.filter(p => p.categoria === 'Óculos inteligentes');
    assert.equal(smart.length, 16);
    for (const product of smart) {
      assert.equal(product.preco, smartPrices[product.id]);
      assert.equal(context.precoComDescontoPix(product), Math.round(smartPrices[product.id] * 90) / 100);
      assert.equal(product.precoPix, context.precoComDescontoPix(product));
    }
  }
  console.log('Smart product frontend pricing tests passed.');
  const femalePrices = JSON.parse(fs.readFileSync(path.join(__dirname, '../female-product-prices.json'), 'utf8'));
  const femaleDefaults = context.LOJA_PADRAO.produtos.filter(p => p.categoria === 'Armações femininas');
  assert.equal(femaleDefaults.length, 53);
  for (const product of femaleDefaults) {
    assert.equal(product.preco, femalePrices[product.id]);
    assert.equal(context.percentualDescontoPixProduto(product), 10);
    assert.equal(context.precoComDescontoPix(product), Math.round(product.preco * 90) / 100);
    assert.equal(product.precoPix, context.precoComDescontoPix(product));
  }
  assert.equal(context.percentualDescontoPixProduto(smartDefaults[0]), 10);
  savedStore = JSON.stringify({ versaoReducaoPrecos: 2, versaoPrecosFemininos: 1, categorias: ['Todos'], produtos: femaleDefaults.map(p => ({ ...p, preco: 999, precoPix: 999, aplicarDescontoPix: false })) });
  for (let reload = 0; reload < 2; reload++) {
    const females = context.carregarLojaConfigurada().produtos.filter(p => p.categoria === 'Armações femininas');
    assert.equal(females.length, 53);
    for (const product of females) {
      assert.equal(product.preco, femalePrices[product.id]);
      assert.equal(product.precoPix, Math.round(product.preco * 90) / 100);
    }
  }
  console.log('Female frontend pricing tests passed.');
  const malePrices = JSON.parse(fs.readFileSync(path.join(__dirname, '../male-product-prices.json'), 'utf8'));
  const maleDefaults = context.LOJA_PADRAO.produtos.filter(p => p.categoria === 'Armações masculinas');
  assert.equal(maleDefaults.length, 47);
  for (const product of maleDefaults) {
    assert.equal(product.preco, malePrices[product.id]);
    assert.equal(context.percentualDescontoPixProduto(product), 10);
    assert.equal(context.precoComDescontoPix(product), Math.round(product.preco * 90) / 100);
    assert.equal(product.precoPix, context.precoComDescontoPix(product));
  }
  assert.equal(context.percentualDescontoPixProduto(smartDefaults[0]), 10);
  savedStore = JSON.stringify({ versaoReducaoPrecos: 2, versaoPrecosMasculinos: 1, categorias: ['Todos'], produtos: maleDefaults.map(p => ({ ...p, preco: 999, precoPix: 999, aplicarDescontoPix: false })) });
  for (let reload = 0; reload < 2; reload++) {
    const males = context.carregarLojaConfigurada().produtos.filter(p => p.categoria === 'Armações masculinas');
    assert.equal(males.length, 47);
    for (const product of males) {
      assert.equal(product.preco, malePrices[product.id]);
      assert.equal(product.precoPix, Math.round(product.preco * 90) / 100);
    }
  }
  console.log('Male frontend pricing tests passed.');
  const otherPrices = JSON.parse(fs.readFileSync(path.join(__dirname, '../other-product-prices.json'), 'utf8'));
  const otherDefaults = context.LOJA_PADRAO.produtos.filter(p => p.categoria === 'Outros óculos de grau');
  assert.equal(otherDefaults.length, 20);
  for (const product of otherDefaults) {
    assert.equal(product.preco, otherPrices[product.id]);
    assert.equal(context.percentualDescontoPixProduto(product), 10);
    assert.equal(context.precoComDescontoPix(product), Math.round(product.preco * 90) / 100);
    assert.equal(product.precoPix, context.precoComDescontoPix(product));
  }
  assert.equal(context.percentualDescontoPixProduto(smartDefaults[0]), 10);
  savedStore = JSON.stringify({ versaoReducaoPrecos: 2, versaoPrecosOutros: 1, categorias: ['Todos'], produtos: otherDefaults.map(p => ({ ...p, preco: 999, precoPix: 999, aplicarDescontoPix: false })) });
  for (let reload = 0; reload < 2; reload++) {
    const others = context.carregarLojaConfigurada().produtos.filter(p => p.categoria === 'Outros óculos de grau');
    assert.equal(others.length, 20);
    for (const product of others) {
      assert.equal(product.preco, otherPrices[product.id]);
      assert.equal(product.precoPix, Math.round(product.preco * 90) / 100);
    }
  }
  console.log('Other frontend pricing tests passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
