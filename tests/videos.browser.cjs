const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const root = path.resolve(__dirname, '..');
const types = { html: 'text/html; charset=utf-8', js: 'text/javascript', css: 'text/css', svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', mp4: 'video/mp4' };
const server = http.createServer((req, res) => {
  const file = path.resolve(root, '.' + new URL(req.url, 'http://localhost').pathname);
  const type = types[path.extname(file).slice(1)];
  if (!file.startsWith(root + path.sep) || !type || !fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
  const size = fs.statSync(file).size;
  const range = req.headers.range?.match(/^bytes=(\d+)-(\d*)$/);
  const start = range ? Number(range[1]) : 0;
  const end = range && range[2] ? Math.min(size - 1, Number(range[2])) : size - 1;
  res.setHeader('Content-Type', type);
  res.setHeader('Accept-Ranges', 'bytes');
  if (start >= size || start > end) { res.writeHead(416); res.end(); return; }
  res.setHeader('Content-Length', end - start + 1);
  if (range) { res.statusCode = 206; res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`); }
  fs.createReadStream(file, { start, end }).pipe(res);
});
const product = { id: 'meta-fixture', nome: 'Óculos Ray-Ban Meta Wayfarer', categoria: 'Óculos inteligentes',
  descricao: 'Produto de teste.', preco: 100, estoque: 3, imagem: '/imagens/held-photo.svg', imagens: [] };

async function main() {
  const video = fs.readFileSync(path.join(root, 'rbm-pdp-aperol-d-optimized-data.mp4'));
  assert.ok(video.indexOf(Buffer.from('moov')) < video.indexOf(Buffer.from('mdat')), 'Video metadata must precede frames for progressive playback');
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ executablePath: process.env.TEST_CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  const base = `http://127.0.0.1:${server.address().port}`;
  const artifacts = path.join(root, '.auto-publish');
  fs.mkdirSync(artifacts, { recursive: true });
  async function setup(options) {
    const page = await browser.newPage(options);
    const errors = [];
    const mediaRequests = [];
    let holdStore = false;
    let releaseStore;
    let holdPhoto = false;
    let releasePhoto;
    let storeGate;
    let photoGate;
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => { if (request.url().includes('.mp4')) mediaRequests.push(request.url()); });
    await page.addInitScript(() => {
      localStorage.setItem('mn_analytics_consent_v2', 'rejected');
      sessionStorage.setItem('vemari_pix_welcome_10_v1', 'seen');
    });
    await page.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin !== base) return route.abort();
      if (url.pathname === '/imagens/held-photo.svg') {
        if (holdPhoto) await photoGate;
        return route.fulfill({ contentType: 'image/svg+xml', body: fs.readFileSync(path.join(root, 'imagens/logo.svg')) });
      }
      if (url.pathname === '/api/store') {
        if (holdStore) await storeGate;
        return route.fulfill({ json: { loja: {}, produtos: [product], categorias: ['Todos', 'Óculos inteligentes'], pix: {}, pagamento: { metodo: 'pix' } } });
      }
      if (url.pathname.startsWith('/api/')) return route.fulfill({ json: { ok: true, paymentConfigured: false } });
      return route.continue();
    });
    return { page, errors, mediaRequests,
      holdStore() { holdStore = true; storeGate = new Promise(resolve => { releaseStore = resolve; }); },
      holdPhoto() { holdPhoto = true; photoGate = new Promise(resolve => { releasePhoto = resolve; }); },
      release() { releaseStore?.(); releasePhoto?.(); } };
  }
  async function playing(page, selector) {
    await page.waitForFunction(selector => {
      const el = document.querySelector(selector);
      return el && !el.paused && el.currentTime > 0.05 && el.videoWidth > 0 && el.readyState >= 2;
    }, selector, { timeout: 15000 });
    const state = await page.locator(selector).evaluate(el => ({ muted: el.muted, inline: el.playsInline, error: el.error?.code || null }));
    assert.deepEqual(state, { muted: true, inline: true, error: null });
  }
  try {
    for (const [name, options] of [
      ['desktop', { viewport: { width: 1366, height: 900 } }],
      ['android', { viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }],
      ['iphone', { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 }]
    ]) {
      const fixture = await setup(options);
      const { page } = fixture;
      try {
        fixture.holdStore();
        await page.goto(base + '/index.html', { waitUntil: 'domcontentloaded' });
        await page.locator('.hero').scrollIntoViewIfNeeded();
        await playing(page, '.hero-video');
        if (options.isMobile) {
          assert.equal(await page.locator('.hero-video').evaluate(el => getComputedStyle(el).objectFit), 'contain');
          const ratio = await page.locator('.hero-video').evaluate(el => el.getBoundingClientRect().width / el.getBoundingClientRect().height);
          assert.ok(Math.abs(ratio - 298 / 135) < 0.05, 'Mobile home video must preserve the full frame');
        }
        assert.equal(await page.locator('[data-add]').count(), 0, 'Home video must play before the catalog resolves');
        await page.screenshot({ path: path.join(artifacts, `video-${name}-home.png`) });
        fixture.release();
        await page.waitForSelector('[data-add]');
        fixture.holdPhoto();
        await page.goto(base + '/produto.html?id=meta-fixture', { waitUntil: 'domcontentloaded' });
        await page.waitForSelector('#productDemoVideo:not([hidden])');
        await page.locator('#productDemoVideo').scrollIntoViewIfNeeded();
        await playing(page, '#productDemoVideoPlayer');
        if (options.isMobile) assert.equal(await page.locator('#productDemoVideoPlayer').evaluate(el => getComputedStyle(el).objectFit), 'contain');
        assert.equal(await page.locator('#productMainImage').evaluate(el => el.complete), false, 'Product video must play while its photo is still pending');
        await page.screenshot({ path: path.join(artifacts, `video-${name}-product.png`) });
        assert.deepEqual(fixture.errors, []);
        console.log(`PASS: ${name} plays real home/product video independently of catalog/photo loads`);
      } finally { fixture.release(); await page.close(); }
    }
    const fixture = await setup({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    try {
      const { page } = fixture;
      await page.addInitScript(() => {
        const nativePlay = HTMLMediaElement.prototype.play;
        window.denyVideoAutoplay = true;
        HTMLMediaElement.prototype.play = function () {
          if (window.denyVideoAutoplay) { this.autoplay = false; return Promise.reject(new DOMException('Gesture required', 'NotAllowedError')); }
          return nativePlay.call(this);
        };
        document.addEventListener('click', event => { if (event.target.closest('.video-play-button')) window.denyVideoAutoplay = false; }, true);
      });
      await page.goto(base + '/index.html', { waitUntil: 'domcontentloaded' });
      await page.locator('.hero').scrollIntoViewIfNeeded();
      await page.locator('#heroVideoPlay').waitFor({ state: 'visible' });
      await page.locator('#heroVideoPlay').tap();
      await playing(page, '.hero-video');
      assert.equal(await page.locator('#heroVideoPlay').isVisible(), false);
      assert.deepEqual(fixture.errors, []);
      console.log('PASS: mobile tap starts the actual video when automatic playback is blocked');
    } finally { fixture.release(); await fixture.page.close(); }
    const checkout = await setup({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    try {
      await checkout.page.goto(base + '/index.html?checkout=1', { waitUntil: 'domcontentloaded' });
      await checkout.page.waitForSelector('#cartDrawer.aberto');
      assert.equal(checkout.mediaRequests.length, 0, 'Checkout must not download the home video');
      console.log('PASS: direct checkout does not start or download the background video');
    } finally { checkout.release(); await checkout.page.close(); }
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
