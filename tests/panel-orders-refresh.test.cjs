const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

async function main() {
  const source = fs.readFileSync(path.join(__dirname, '../js/admin.js'), 'utf8');
  const start = source.indexOf('async function alterarPedidosPainel(');
  const end = source.indexOf('async function carregarRelatorioAdmin(', start);
  const operations = [];
  let success = true;
  const context = vm.createContext({
    adminCsrfToken: 'test-csrf', Event,
    document: { getElementById: () => ({ value: '30' }) },
    fetch: async (url, options) => {
      assert.equal(url, '/api/admin/orders/panel');
      assert.equal(options.method, 'POST');
      assert.equal(options.headers['X-CSRF-Token'], 'test-csrf');
      assert.deepEqual(JSON.parse(options.body), { action: 'archive' });
      operations.push('archive');
      return { ok: success, json: async () => success ? { count: 11 } : { error: 'Denied' } };
    },
    carregarIndicadoresAdmin: async () => operations.push('metrics'),
    window: { dispatchEvent: event => operations.push(event.type) }
  });
  vm.runInContext(source.slice(start, end), context);
  const result = await context.alterarPedidosPainel('archive');
  assert.equal(result.count, 11);
  assert.deepEqual(operations, ['archive', 'metrics', 'panel-orders-updated']);
  operations.length = 0;
  success = false;
  await assert.rejects(context.alterarPedidosPainel('archive'), /Denied/);
  assert.deepEqual(operations, ['archive']);

  const layout = fs.readFileSync(path.join(__dirname, '../js/admin-layout.js'), 'utf8');
  const refreshStart = layout.indexOf('let recentRevision = 0;');
  const refreshEnd = layout.indexOf('window.addEventListener("panel-orders-updated"', refreshStart);
  const pending = [];
  const target = { innerHTML: '', querySelectorAll: () => [] };
  const recentContext = vm.createContext({
    target, request: () => new Promise(resolve => pending.push(resolve)),
    esc: value => value, money: value => value, signal: undefined
  });
  vm.runInContext(layout.slice(refreshStart, refreshEnd) + '\nglobalThis.refresh = loadRecentOrders;', recentContext);
  const oldRequest = recentContext.refresh();
  const clearedRequest = recentContext.refresh();
  pending[1]({ orders: [] });
  await clearedRequest;
  const clearedMarkup = target.innerHTML;
  assert.match(clearedMarkup, /Nenhum pedido recebido/);
  pending[0]({ orders: [{ id: 'stale-order', created_at: 1, total_cents: 100, payment_status: 'pending' }] });
  await oldRequest;
  assert.equal(target.innerHTML, clearedMarkup, 'An earlier request must not restore stale orders after clearing');
  console.log('Panel clearing refresh, CSRF, error handling and stale-response tests passed.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
