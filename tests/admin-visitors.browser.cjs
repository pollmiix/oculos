// Run with a local Playwright installation via PLAYWRIGHT_MODULE_PATH.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const root = path.resolve(__dirname, '..');
const now = Math.floor(Date.now() / 1000);
const original = Array.from({ length: 26 }, (_, i) => ({
  session_id: `visitor-${String(i).padStart(3, '0')}`, first_seen: now - 120, last_seen: now,
  ip_address: `192.0.2.${i + 1}`, platform: 'Windows', device: 'desktop', browser: 'Chrome',
  page_path: '/produto.html', source: 'https://example.org', event_name: 'view_item',
  product_name: i ? 'Óculos inteligentes' : '<img src=x onerror="window.unsafe=true">',
  online: true, blocked: false, location: 'São Paulo / SP / BR'
}));
let visits = structuredClone(original);
let role = 'owner';
let visitorRequests = 0;
let fail = false;
const collectedEvents = [];
const actions = [];
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const file = path.resolve(root, '.' + url.pathname);
  if (!file.startsWith(root + path.sep) || !/\.(js|css|png|svg|html)$/.test(file) && url.pathname !== '/admin.php') {
    res.writeHead(404); res.end(); return;
  }
  try {
    let content = fs.readFileSync(file);
    if (url.pathname === '/admin.php') content = content.toString().replace(/^<\?php[\s\S]*?\?>/, '');
    res.setHeader('Content-Type', url.pathname === '/admin.php' || file.endsWith('.html') ? 'text/html; charset=utf-8'
      : file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : file.endsWith('.svg') ? 'image/svg+xml' : 'image/png');
    res.end(content);
  } catch { res.writeHead(404); res.end(); }
});

async function main() {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ executablePath: process.env.TEST_CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, reducedMotion: 'reduce' });
    await page.clock.install();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('dialog', dialog => dialog.accept());
    const base = `http://127.0.0.1:${server.address().port}`;
    await page.route('**/*', async route => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.origin !== base) return route.abort();
      if (!url.pathname.startsWith('/api/')) return route.continue();
      let data = {};
      if (url.pathname === '/api/events') { collectedEvents.push(request.postDataJSON()); data = { accepted: true }; }
      if (url.pathname === '/api/admin/session') data = { csrfToken: 'test-csrf', admin: { role } };
      if (url.pathname === '/api/store') data = { loja: {}, produtos: [], categorias: [] };
      if (url.pathname === '/api/admin/accounts') data = { accounts: [] };
      if (url.pathname === '/api/admin/orders') data = { orders: [] };
      if (url.pathname === '/api/admin/dashboard') data = { orders: 0, revenueCents: 0, paidOrders: 0, pendingOrders: 0, products: 0, lowStock: 0, salesByDay: [], trafficByDay: [] };
      if (url.pathname === '/api/admin/visitors') {
        visitorRequests++;
        if (request.method() === 'POST') {
          assert.equal(request.headers()['x-csrf-token'], 'test-csrf');
          const body = request.postDataJSON();
          actions.push(body.action);
          const visit = visits.find(row => row.session_id === body.sessionId);
          if (body.action === 'block') { visit.blocked = true; visit.online = false; }
          if (body.action === 'unblock') { visit.blocked = false; visit.online = true; }
          if (body.action === 'unblock_all') visits.forEach(row => { row.blocked = false; row.online = true; });
          if (body.action === 'delete') visits = visits.filter(row => row !== visit);
          data = { success: true };
        } else {
          if (fail) return route.fulfill({ status: 500, json: { error: 'Temporary failure' } });
          const filter = url.searchParams.get('filter');
          const filtered = visits.filter(row => filter === 'blocked' ? row.blocked : filter === 'online' ? row.online : true);
          const pages = Math.max(1, Math.ceil(filtered.length / 25));
          const current = Math.max(1, Math.min(pages, Number(url.searchParams.get('page') || 1)));
          data = { visits: filtered.slice((current - 1) * 25, current * 25), page: current, pages, total: filtered.length, serverTime: now,
            summary: { visits: visits.length, online: visits.filter(v => v.online).length, blocked: visits.filter(v => v.blocked).length } };
        }
      }
      await route.fulfill({ json: data });
    });
    await page.goto(base + '/admin.php');
    await page.waitForSelector('.visitor-table tbody tr:nth-child(25)');
    assert.equal(await page.locator('.visitor-table th').count(), 11);
    assert.equal(await page.locator('.visitor-table img').count(), 0, 'Visitor content must be escaped');
    await page.locator('[data-visit-action=block]').first().click();
    await page.waitForSelector('.visitor-status[data-state=blocked]');
    await page.locator('[data-visit-filter]').selectOption('blocked');
    await page.waitForFunction(() => document.querySelector('.visitor-table tbody').children.length === 1);
    await page.locator('[data-visit-action=unblock]').click();
    await page.waitForSelector('.visitor-empty');
    await page.locator('[data-visit-filter]').selectOption('');
    await page.waitForSelector('.visitor-table tbody tr:nth-child(25)');
    await page.locator('[data-visit-next]').click();
    await page.waitForFunction(() => document.querySelector('[data-visit-page]').textContent.includes('Página 2'));
    await page.locator('[data-visit-action=delete]').click();
    await page.waitForFunction(() => document.querySelector('[data-visit-page]').textContent.includes('Página 1 de 1'));
    fail = true;
    await page.locator('[data-visit-refresh]').click();
    await page.waitForFunction(() => document.querySelector('.visitor-message').textContent.includes('tentar novamente'));
    fail = false;
    await page.locator('[data-visit-refresh]').click();
    await page.waitForFunction(() => document.querySelector('.visitor-message').textContent.includes('Atualizado em'));
    await page.locator('[data-dashboard-view=visits]').click();
    assert.equal(await page.locator('[data-admin-panel=visits] .visitor-panel').count(), 1);
    fs.mkdirSync(path.join(root, '.auto-publish'), { recursive: true });
    await page.screenshot({ path: path.join(root, '.auto-publish/visits-desktop.png') });
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'The table must scroll within its container on mobile');
    await page.waitForFunction(() => document.querySelector('.dashboard-sidebar').getBoundingClientRect().right <= 0);
    await page.screenshot({ path: path.join(root, '.auto-publish/visits-mobile.png') });
    role = 'analyst';
    const before = visitorRequests;
    await page.goto(base + '/admin.php');
    await page.waitForSelector('[data-dashboard-view=analytics]');
    assert.equal(await page.locator('[data-dashboard-view=visits]').count(), 0);
    assert.equal(await page.locator('.visitor-panel').count(), 0);
    assert.equal(visitorRequests, before);
    await page.goto(base + '/contato.html');
    await page.waitForSelector('#analyticsConsent');
    await page.clock.fastForward(31000);
    assert.equal(collectedEvents.length, 0, 'No events before consent');
    await page.locator('[data-consent=reject]').click();
    await page.clock.fastForward(31000);
    assert.equal(collectedEvents.length, 0, 'No heartbeat after rejection');
    await page.evaluate(() => { localStorage.clear(); localStorage.setItem('mn_analytics_consent_v1', 'accepted'); });
    await page.reload();
    await page.waitForSelector('#analyticsConsent');
    assert.equal(collectedEvents.length, 0, 'Old consent must not enable newly disclosed IP collection');
    await page.evaluate(() => window.storeAnalytics.track('view_item', { productId: 'test-product' }));
    await page.locator('[data-consent=accept]').click();
    await page.waitForFunction(() => !document.querySelector('#analyticsConsent'));
    await Promise.all([
      page.waitForResponse(response => response.url().endsWith('/api/events') && response.request().postDataJSON().name === 'heartbeat'),
      page.clock.fastForward(1000)
    ]);
    assert.equal(collectedEvents[0].name, 'page_view');
    assert.equal(collectedEvents[0].productId, 'test-product');
    assert.ok(collectedEvents.some(event => event.name === 'heartbeat'));
    assert.deepEqual(actions, ['block', 'unblock', 'delete']);
    assert.deepEqual(errors, []);
    console.log('Browser passed: admin integration, 11 columns, escaped content, block/unblock/delete, CSRF, filters, pagination, error recovery, mobile layout, owner-only access, consent renewal, rejection and heartbeat.');
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
