(() => {
  const stages = { page_view: 'Navegando na loja', view_item: 'Visualizando produto', search: 'Pesquisando produtos',
    click_buy: 'Clicou em comprar', add_to_cart: 'Produto na sacola', begin_checkout: 'Preenchendo checkout' };
  const payments = { pending: 'Pix gerado · Aguardando pagamento', reported: 'Pagamento informado · Em conferência',
    paid: 'Compra confirmada', cancelled: 'Pagamento cancelado', refunded: 'Pagamento reembolsado' };
  window.criarListaVisitas = ({ request, mutate, escape: esc, signal }) => {
    const element = document.createElement('section');
    element.className = 'visitor-panel';
    element.setAttribute('aria-label', 'Lista de visitas');
    element.innerHTML = `
      <div class="dashboard-section-heading"><div><h2>Lista de visitas</h2><p>Acompanhe a atividade dos visitantes da sua loja.</p></div>
      <div class="visitor-tools"><button type="button" class="btn btn-ghost" data-visit-refresh>Atualizar painel</button>
      <button type="button" class="btn btn-ghost" data-visit-unblock-all>Desbloquear todos os IPs</button></div></div>
      <div class="visitor-summary" aria-label="Resumo de visitas"></div>
      <div class="visitor-controls"><label>Mostrar <select data-visit-filter><option value="">Todas as visitas</option><option value="online">Pessoas online</option><option value="blocked">Visitas bloqueadas</option></select></label>
      <label class="visitor-auto"><input type="checkbox" data-visit-auto checked> Atualização em tempo real <small>A cada 1 segundo</small></label></div>
      <p class="visitor-message" role="status" aria-live="polite"></p>
      <div class="admin-table-wrap visitor-table-wrap"><table class="visitor-table"><thead><tr>
      <th>Bloqueio</th><th>Ação</th><th>Última atividade</th><th>IP</th><th>Dispositivo</th><th>Navegador</th><th>Status</th><th>Etapa / produto</th><th>Página / link</th><th>Proveniente</th><th>Localização aprox. (IP)</th>
      </tr></thead><tbody><tr><td colspan="11">Carregando visitas...</td></tr></tbody></table></div>
      <div class="visitor-pagination"><button type="button" class="btn btn-ghost" data-visit-prev>‹ Anterior</button><span data-visit-page></span><button type="button" class="btn btn-ghost" data-visit-next>Próxima ›</button></div>
      <p class="visitor-footnote">Visitas registradas após aceitar métricas. Presença ao vivo: atualização a cada segundo; offline após 10 segundos sem sinal. Localização por IP é aproximada e depende dos dados da hospedagem.</p>`;
    const find = selector => element.querySelector(selector);
    const status = find('.visitor-message');
    let page = 1;
    let active = false;
    let busy = false;
    let revision = 0;
    let lastData;
    const date = value => new Date(Number(value) * 1000).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    const safePage = path => typeof path === 'string' && /^\/(?!\/)/.test(path) && !/[\\\s?#]/.test(path);
    function render(data) {
      lastData = data;
      page = data.page;
      const summary = data.summary;
      find('.visitor-summary').innerHTML = [['Visitas', summary.visits], ['Pessoas online', summary.online], ['IPs bloqueados', summary.blocked]]
        .map(([label, value]) => `<article><span>${label}</span><strong>${Number(value) || 0}</strong></article>`).join('');
      find('tbody').innerHTML = data.visits.length ? data.visits.map(visit => {
        const stage = visit.order_id && Number(visit.order_created) >= Number(visit.first_seen)
          ? payments[visit.payment_status] || 'Pedido registrado' : stages[visit.event_name] || 'Navegando na loja';
        const device = { desktop: 'Computador', mobile: 'Celular', tablet: 'Tablet' }[visit.device] || '';
        const source = visit.source === 'direct' ? 'Acesso direto' : visit.source || 'Não informado';
        return `<tr>
          <td><button type="button" class="visitor-action" data-visit-action="${visit.blocked ? 'unblock' : 'block'}" data-session="${esc(visit.session_id)}" ${visit.ip_address ? '' : 'disabled'}>${visit.blocked ? 'Desbloquear IP' : 'Bloquear IP'}</button></td>
          <td><button type="button" class="visitor-action visitor-delete" data-visit-action="delete" data-session="${esc(visit.session_id)}">Excluir</button></td>
          <td>${esc(date(visit.last_seen))}</td><td class="visitor-ip">${esc(visit.ip_address || 'Não disponível')}</td>
          <td>${esc(visit.platform)}<small>${esc(device)}</small></td><td>${esc(visit.browser)}</td>
          <td><span class="visitor-status" data-state="${visit.blocked ? 'blocked' : visit.online ? 'online' : 'offline'}">${visit.blocked ? 'Bloqueado' : visit.online ? 'Online' : 'Offline'}</span></td>
          <td class="visitor-stage"><strong>${esc(stage)}</strong>${visit.product_name ? `<span>${esc(visit.product_name)}</span>` : ''}<small>Visitante ${esc(visit.session_id.slice(0, 8))}</small>${visit.order_id ? `<small>Pedido ${esc(visit.order_id)}</small>` : ''}</td>
          <td>${safePage(visit.page_path) ? `<a href="${esc(visit.page_path)}" target="_blank" rel="noopener noreferrer">${esc(visit.page_path)}</a>` : esc(visit.page_path)}</td>
          <td class="visitor-source" title="${esc(source)}">${esc(source)}</td><td>${esc(visit.location || 'Não disponível')}</td></tr>`;
      }).join('') : '<tr><td colspan="11" class="visitor-empty">Nenhuma visita neste filtro. Novos registros aparecerão após o visitante aceitar as métricas.</td></tr>';
      find('[data-visit-page]').textContent = `Página ${data.page} de ${data.pages} (${data.total} ${data.total === 1 ? 'registro' : 'registros'})`;
      find('[data-visit-prev]').disabled = data.page <= 1;
      find('[data-visit-next]').disabled = data.page >= data.pages;
      find('[data-visit-unblock-all]').disabled = !summary.blocked;
    }
    async function load() {
      if (busy || signal.aborted || !element.isConnected) return;
      busy = true;
      const current = ++revision;
      find('[data-visit-refresh]').disabled = true;
      find('[data-visit-filter]').disabled = true;
      try {
        const params = new URLSearchParams({ page: String(page), filter: find('[data-visit-filter]').value });
        const data = await request(`/api/admin/visitors?${params}`);
        if (signal.aborted || !element.isConnected || current !== revision) return;
        render(data);
        status.textContent = `Atualizado em ${date(data.serverTime)}.`;
      } catch (error) {
        if (!signal.aborted && current === revision) status.textContent = `${error.message} Use Atualizar painel para tentar novamente.`;
      } finally {
        busy = false;
        find('[data-visit-refresh]').disabled = false;
        find('[data-visit-filter]').disabled = false;
      }
    }
    async function action(name, sessionId) {
      if (busy) return;
      const confirmations = {
        delete: 'Excluir esta visita e seus eventos? Os pedidos e pagamentos serão preservados. A pessoa poderá aparecer novamente se continuar navegando.',
        block: 'Bloquear este IP nos serviços da loja? Outras pessoas na mesma rede também podem ser afetadas.',
        unblock_all: 'Desbloquear todos os IPs?'
      };
      if (confirmations[name] && !window.confirm(confirmations[name])) return;
      busy = true;
      find('[data-visit-filter]').disabled = true;
      element.querySelectorAll('[data-visit-action], [data-visit-unblock-all], [data-visit-refresh]').forEach(button => { button.disabled = true; });
      status.textContent = 'Atualizando visita...';
      try {
        await mutate({ action: name, sessionId });
      } catch (error) {
        status.textContent = error.message;
        busy = false;
        if (lastData) render(lastData);
        find('[data-visit-refresh]').disabled = false;
        find('[data-visit-filter]').disabled = false;
        return;
      }
      busy = false;
      await load();
    }
    element.addEventListener('click', event => {
      const button = event.target.closest('button');
      if (!button) return;
      if (button.hasAttribute('data-visit-refresh')) load();
      if (button.hasAttribute('data-visit-unblock-all')) action('unblock_all');
      if (button.dataset.visitAction) action(button.dataset.visitAction, button.dataset.session);
      if (!busy && button.hasAttribute('data-visit-prev')) { page--; load(); }
      if (!busy && button.hasAttribute('data-visit-next')) { page++; load(); }
    }, { signal });
    find('[data-visit-filter]').addEventListener('change', () => { page = 1; load(); }, { signal });
    const timer = setInterval(() => {
      if (!element.isConnected) { clearInterval(timer); return; }
      if (active && !document.hidden && find('[data-visit-auto]').checked) load();
    }, 1000);
    signal.addEventListener('abort', () => { clearInterval(timer); revision++; }, { once: true });
    document.addEventListener('visibilitychange', () => { if (active && !document.hidden && find('[data-visit-auto]').checked) load(); }, { signal });
    return { element, setActive(value) { active = value; if (active) load(); } };
  };
})();
