window.iniciarConexaoGateway = function (csrf, onActivated) {
  const status = document.getElementById("gatewayConnectionStatus");
  const steps = document.getElementById("gatewayConnectionSteps");
  const result = document.getElementById("gatewayConnectionResult");
  const test = document.getElementById("testGateway");
  const activate = document.getElementById("activateGateway");
  let busy = false;
  async function read(response) {
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Não foi possível verificar a integração.");
    return data;
  }
  async function refresh() {
    const data = await read(await fetch("/api/admin/gateway/status", { cache: "no-store" }));
    status.textContent = data.active && data.configured ? "Pix automático selecionado na loja" : "Ativação do Pix automático";
    steps.replaceChildren();
    for (const [ready, label] of [[data.configured, "Chave privada configurada no servidor"], [data.transportReady, "Servidor preparado para falar com a BlackCat"], [data.active, "Gateway selecionado no checkout"]]) {
      const item = document.createElement("li");
      item.textContent = `${ready ? "✓" : "○"} ${label}`;
      item.dataset.ready = String(ready);
      steps.append(item);
    }
    activate.disabled = true;
    return data;
  }
  async function run(action) {
    if (busy) return;
    busy = true; test.disabled = true; activate.disabled = true;
    result.textContent = action === "test" ? "Validando a conta na BlackCat, sem gerar cobranças..." : "Ativando o Pix automático...";
    try {
      const data = await read(await fetch(`/api/admin/gateway/${action}`, { method: "POST", headers: { "X-CSRF-Token": csrf } }));
      if (action === "activate") {
        onActivated();
        await refresh();
        result.textContent = "Gateway ativado. Faça uma compra de validação para conferir o recebimento e a confirmação do pedido.";
      } else {
        await refresh();
        result.textContent = `Conexão validada: ${data.seller.name}. Você já pode ativar o Pix automático.`;
        activate.disabled = false;
      }
    } catch (error) { result.textContent = error.message; }
    finally { busy = false; test.disabled = false; }
  }
  test.onclick = () => run("test");
  activate.onclick = () => run("activate");
  refresh().catch(error => { status.textContent = error.message; });
};
