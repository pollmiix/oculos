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
    assert.equal(savedProduct.preco, 60, 'Saved prices must decrease by 40% exactly once.');
    assert.equal(savedProduct.antigo, 90, 'Original prices must also decrease by 40%.');
    assert.equal(savedProduct.precoPix, 54);
    assert.equal(savedProduct.precoPromocional, 57);
    assert.equal(savedProduct.estoque, 2, 'Price changes must preserve stock.');
  }
  console.log('Published catalog authority tests passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
