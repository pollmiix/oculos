const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const root = path.resolve(__dirname, '..');
const product = { id: 'remote-only-glasses', nome: 'Óculos "Sol" & estilo', categoria: 'Óculos inteligentes',
  descricao: 'Produto de teste do catálogo publicado.', preco: 100, estoque: 4, imagem: 'imagens/logo.svg', imagens: ['imagens/logo.svg'] };
let products = [product];
let apiFailure = false;
let storeGate;
let healthGate;
const server = http.createServer((req, res) => {
  const file = path.resolve(root, '.' + new URL(req.url, 'http://localhost').pathname);
  if (!file.startsWith(root + path.sep) || !/\.(html|js|css|svg|png)$/.test(file)) { res.writeHead(404); res.end(); return; }
  try {
    res.setHeader('Content-Type', file.endsWith('.html') ? 'text/html; charset=utf-8' : file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : file.endsWith('.png') ? 'image/png' : 'image/svg+xml');
    res.end(fs.readFileSync(file));
  } catch { res.writeHead(404); res.end(); }
});
async function main() {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ executablePath: process.env.TEST_CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  const base = `http://127.0.0.1:${server.address().port}`;
  let failures = 0;
  async function check(name, seed, fn) {
    const page = await browser.newPage({ viewport: { width: 1366, height: 900 }, reducedMotion: 'reduce' });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('dialog', dialog => dialog.accept());
    await page.addInitScript(values => {
      if (!sessionStorage.getItem('fixture-seeded')) {
        sessionStorage.setItem('fixture-seeded', '1');
        localStorage.clear();
        localStorage.setItem('mn_analytics_consent_v2', 'rejected');
        sessionStorage.setItem('vemari_pix_welcome_10_v1', 'seen');
        for (const [key, value] of Object.entries(values)) localStorage.setItem(key, value);
      }
    }, seed);
    await page.route('**/*', async route => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.origin !== base) return route.abort();
      if (!url.pathname.startsWith('/api/')) return route.continue();
      if (url.pathname === '/api/store') {
        if (storeGate) await storeGate;
        if (apiFailure) return route.fulfill({ status: 503, json: { error: 'Temporary outage' } });
        return route.fulfill({ json: { produtos: products, categorias: ['Todos', 'Óculos inteligentes'], loja: {},
          pix: { tipo: 'email', chave: 'pagamentos@example.com', nomeRecebedor: 'LOJA TESTE', cidade: 'SAO PAULO' }, pagamento: { metodo: 'pix' } } });
      }
      if (url.pathname === '/api/health') {
        if (healthGate) await healthGate;
        return route.fulfill({ json: { ok: true, paymentConfigured: false } });
      }
      return route.fulfill({ json: { success: true } });
    });
    try { await fn(page, errors); console.log('PASS: ' + name); }
    catch (error) { failures++; console.error('FAIL: ' + name + ': ' + error.message); }
    finally { await page.close(); products = [product]; apiFailure = false; storeGate = null; healthGate = null; }
  }
  const cart = [{ id: product.id, qtd: 1, preco: 90, nome: product.nome, imagem: product.imagem }];
  try {
    await check('Add to bag stays on the product page', {}, async (page, errors) => {
      await page.goto(base + '/produto.html?id=' + product.id);
      await page.waitForFunction(() => document.querySelector('#productMainImage').naturalWidth > 0);
      await page.locator('#productAddButton').click();
      await page.waitForFunction(() => location.pathname === '/index.html' || !document.querySelector('#productAfterAdd')?.hidden);
      assert.equal(new URL(page.url()).pathname, '/produto.html');
      assert.deepEqual(errors, []);
    });
    await check('Buy now opens checkout with the selected product', {}, async (page, errors) => {
      await page.goto(base + '/produto.html?id=' + product.id);
      await Promise.all([page.waitForURL('**/index.html?checkout=1'), page.locator('#productBuyNowButton').click()]);
      await page.waitForSelector('#checkout.aberto');
      assert.equal(await page.locator('#cartCount').textContent(), '1');
      assert.deepEqual(errors, []);
    });
    await check('Published product survives checkout navigation', { mineironet_carrinho: JSON.stringify(cart) }, async (page, errors) => {
      await page.goto(base + '/index.html?checkout=1');
      await page.waitForSelector('[data-add]');
      assert.equal(await page.locator('#cartCount').textContent(), '1');
      assert.ok(await page.locator('#checkout').evaluate(el => el.classList.contains('aberto')));
      assert.deepEqual(errors, []);
    });
    await check('Slow checkout shows the form immediately without a loading message', { mineironet_carrinho: JSON.stringify(cart) }, async (page, errors) => {
      await page.addInitScript(() => sessionStorage.removeItem('vemari_pix_welcome_10_v1'));
      let releaseStore;
      let releaseHealth;
      storeGate = new Promise(resolve => { releaseStore = resolve; });
      healthGate = new Promise(resolve => { releaseHealth = resolve; });
      try {
        await page.goto(base + '/index.html?checkout=1', { waitUntil: 'domcontentloaded' });
        assert.equal(await page.evaluate(() => document.documentElement.classList.contains('checkout-loading')), true);
        assert.equal(await page.locator('#checkoutForm').isVisible(), true);
        assert.equal(await page.locator('#btnPix').isDisabled(), true);
        assert.doesNotMatch(await page.evaluate(() => getComputedStyle(document.body, '::after').content), /Preparando seu checkout/);
        assert.equal(await page.locator('.hero-video').evaluate(video => video.paused), true);
        releaseStore();
        await page.waitForSelector('#checkout.aberto');
        assert.equal(await page.evaluate(() => document.documentElement.classList.contains('checkout-loading')), false);
        assert.equal(await page.locator('#pixWelcome').evaluate(dialog => dialog.open), false);
        fs.mkdirSync(path.join(root, '.auto-publish'), { recursive: true });
        await page.screenshot({ path: path.join(root, '.auto-publish/fixed-checkout.png') });
        await page.setViewportSize({ width: 390, height: 844 });
        await page.waitForFunction(() => document.documentElement.scrollWidth <= innerWidth);
        await page.screenshot({ path: path.join(root, '.auto-publish/fixed-checkout-mobile.png') });
        assert.deepEqual(errors, []);
      } finally { releaseStore(); releaseHealth(); }
    });
    await check('Catalog photos load lazily instead of all at once', {}, async page => {
      products = Array.from({ length: 60 }, (_, i) => ({ ...product, id: `remote-${i}`, imagem: `/imagens/logo.svg?catalogImage=${i}` }));
      const imagesRequested = new Set();
      page.on('request', request => { if (request.url().includes('catalogImage=')) imagesRequested.add(request.url()); });
      await page.goto(base + '/index.html');
      await page.waitForSelector('.card-img img');
      await page.waitForLoadState('networkidle');
      assert.equal(await page.locator('.card-img img').count(), 60);
      assert.equal(await page.locator('.card-img img[loading=lazy][decoding=async]').count(), 60);
      assert.ok(imagesRequested.size < 30, `Loaded ${imagesRequested.size} of 60 images before scrolling`);
    });
    await check('Broken cart storage does not crash the store', { mineironet_carrinho: '{broken' }, async (page, errors) => {
      await page.goto(base + '/index.html');
      await page.waitForSelector('[data-add]', { timeout: 4000 });
      assert.equal(await page.locator('#cartCount').textContent(), '0');
      assert.deepEqual(errors, []);
    });
    await check('Null saved configuration does not crash the store', { mineironet_loja: 'null' }, async (page, errors) => {
      await page.goto(base + '/index.html');
      await page.waitForSelector('[data-add]', { timeout: 4000 });
      assert.deepEqual(errors, []);
    });
    await check('Blocked browser storage does not disable the storefront', {}, async (page, errors) => {
      await page.addInitScript(() => {
        Storage.prototype.getItem = () => { throw new DOMException('Storage blocked', 'SecurityError'); };
        Storage.prototype.setItem = () => { throw new DOMException('Storage blocked', 'SecurityError'); };
      });
      await page.goto(base + '/index.html');
      await page.waitForSelector('[data-add]');
      await page.evaluate(() => document.querySelector('#pixWelcome')?.close());
      if (await page.locator('[data-consent=reject]').isVisible()) await page.locator('[data-consent=reject]').click();
      await page.locator('[data-add]').first().click();
      assert.equal(await page.locator('#cartCount').textContent(), '1');
      assert.deepEqual(errors, []);
    });
    await check('Stale price and quantity follow the published catalog', { mineironet_carrinho: JSON.stringify([{ ...cart[0], preco: 1, qtd: 9 }]) }, async (page, errors) => {
      await page.goto(base + '/index.html?carrinho=1');
      await page.waitForSelector('[data-add]');
      const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('mineironet_carrinho')));
      assert.equal(saved.length, 1);
      assert.equal(saved[0].preco, 90);
      assert.equal(saved[0].qtd, 4);
      assert.deepEqual(errors, []);
    });
    await check('Outage preserves the cart and disables checkout', { mineironet_carrinho: JSON.stringify(cart) }, async (page, errors) => {
      apiFailure = true;
      await page.goto(base + '/index.html?carrinho=1');
      await page.waitForFunction(() => document.querySelector('#btnCheckout').disabled);
      const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('mineironet_carrinho')));
      assert.equal(saved.length, 1);
      assert.match(await page.locator('#grid').textContent(), /carregar|indisponível/i);
      assert.deepEqual(errors, []);
    });
    await check('Back from PIX hides the previous payment code', { mineironet_carrinho: JSON.stringify(cart) }, async page => {
      await page.goto(base + '/index.html');
      await page.waitForSelector('[data-add]');
      await page.evaluate(() => {
        document.querySelector('#checkout').classList.add('aberto', 'pix-gerado');
        document.querySelector('#pixBox').classList.add('visivel');
        document.querySelector('#checkoutForm').style.display = 'none';
      });
      await page.locator('#btnVoltarCheckout').click();
      assert.equal(await page.locator('#pixBox').evaluate(el => el.classList.contains('visivel')), false);
      assert.equal(await page.locator('#checkoutForm').isVisible(), true);
    });
    await check('Product names cannot break image attributes', {}, async page => {
      await page.goto(base + '/index.html');
      await page.waitForSelector('[data-add]');
      assert.equal(await page.locator('.card-img img').first().getAttribute('alt'), product.nome);
      await page.setViewportSize({ width: 390, height: 844 });
      await page.waitForFunction(() => document.documentElement.scrollWidth <= innerWidth);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    });
    await check('Broken cart storage is recoverable on the product page', { mineironet_carrinho: '{broken' }, async (page, errors) => {
      await page.goto(base + '/produto.html?id=' + product.id);
      await page.waitForSelector('#productName');
      assert.equal(await page.locator('#productAddButton').isEnabled(), true);
      assert.deepEqual(errors, []);
    });
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
  if (failures) throw new Error(`${failures} storefront regressions failed`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
