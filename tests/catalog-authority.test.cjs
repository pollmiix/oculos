const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const remoteProduct = {
  id: 'remote-only-product', nome: 'Produto publicado', categoria: 'Óculos inteligentes',
  preco: 100, estoque: 2, imagem: 'https://example.com/product.jpg'
};
let remoteProducts = [remoteProduct];
const context = {
  structuredClone, URL,
  console: { error() {} },
  localStorage: { getItem() { return null; }, setItem() {} },
  location: { protocol: 'https:' },
  fetch: async () => ({
    ok: true, status: 200,
    json: async () => ({ loja: {}, pix: {}, pagamento: {}, categorias: ['Todos', 'Óculos inteligentes'], produtos: structuredClone(remoteProducts) })
  })
};
context.window = context;
vm.createContext(context);
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

  const oldCatalog = context.aplicarProdutosComplementares({ produtos: [structuredClone(remoteProduct)], categorias: ['Todos'] });
  assert.equal(oldCatalog.produtos.find(item => item.id === remoteProduct.id).estoque, 2, 'Legacy migration must preserve manually entered stock.');
  console.log('Published catalog authority tests passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
