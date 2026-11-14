window.iniciarTesteGateway = function (csrf) {
  window.encerrarTesteGateway?.();
  const controller = new AbortController();
  const $ = id => document.getElementById(id);
  const form = $("gatewayChargeForm");
  const fields = $("gatewayChargeFields");
  const message = $("gatewayChargeMessage");
  const result = $("gatewayChargeResult");
  const storageKey = "vemari_gateway_test_request";
  let requestId = null, timer, pendingRequest = false;
  window.encerrarTesteGateway = () => { clearTimeout(timer); controller.abort(); };
  const money = value => (value / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  const labels = { CREATING: "Criação em processamento", UNKNOWN: "Aguardando resposta do gateway", PENDING: "Aguardando pagamento", PAID: "Pagamento confirmado pela BlackCat", CANCELLED: "Cobrança cancelada ou expirada", REFUNDED: "Pagamento estornado", FAILED: "Cobrança recusada" };
  const terminal = state => ["PAID", "CANCELLED", "REFUNDED", "FAILED"].includes(state);
  function remember(id) {
    requestId = id;
    try { id ? sessionStorage.setItem(storageKey, id) : sessionStorage.removeItem(storageKey); } catch {}
  }
  async function read(response) {
    const data = await response.json();
    if (!response.ok) {
      const error = new Error(data.error || "Não foi possível consultar o gateway.");
      Object.assign(error, { status: response.status, creationUncertain: data.creationUncertain, noChargeCreated: data.noChargeCreated });
      throw error;
    }
    return data;
  }
  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (controller.signal.aborted || !form.isConnected) return;
      if (document.hidden || $("gatewaySettings").hidden) schedule();
      else check(false);
    }, 12000);
  }
  function render(response) {
    const charge = response.data;
    result.hidden = false;
    fields.disabled = true;
    $("gatewayChargeState").textContent = labels[charge.status] || "Situação não confirmada";
    $("gatewayChargeState").dataset.state = charge.status;
    const payment = charge.paymentData || {};
    const expires = new Date(payment.expiresAt || "");
    $("gatewayChargeDetails").textContent = `${charge.transactionId || "Teste em processamento"} · ${money(charge.amount)}${Number.isNaN(expires.getTime()) ? "" : ` · Validade: ${expires.toLocaleString("pt-BR")}`}`;
    const code = payment.copyPaste || (typeof payment.qrCode === "string" && payment.qrCode.startsWith("000201") ? payment.qrCode : "");
    $("gatewayChargeCode").value = code;
    $("copyGatewayTest").disabled = !code;
    const qr = $("gatewayChargeQr");
    qr.replaceChildren(); qr.hidden = true;
    const image = document.createElement("img");
    image.alt = "QR Code Pix da cobrança de teste";
    let imageUrl = "";
    if (code && typeof window.qrcode === "function") {
      try {
        const generated = window.qrcode(0, "M");
        generated.addData(code, "Byte"); generated.make();
        imageUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(generated.createSvgTag(6, 4, image.alt))}`;
      } catch {}
    }
    if (!imageUrl && typeof payment.qrCodeBase64 === "string") {
      if (/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=\s]+$/.test(payment.qrCodeBase64)) imageUrl = payment.qrCodeBase64;
      else if (/^[A-Za-z0-9+/=\s]+$/.test(payment.qrCodeBase64)) imageUrl = `data:image/png;base64,${payment.qrCodeBase64}`;
    }
    if (imageUrl) { image.src = imageUrl; qr.append(image); qr.hidden = false; }
    const invoice = $("gatewayChargeInvoice");
    invoice.hidden = true; invoice.removeAttribute("href");
    try {
      const url = new URL(charge.invoiceUrl);
      if (url.protocol === "https:") { invoice.href = url.href; invoice.hidden = false; }
    } catch {}
    $("newGatewayTest").hidden = !terminal(charge.status);
    if (!terminal(charge.status)) schedule(); else clearTimeout(timer);
  }
  async function check(manual = true) {
    if (!requestId || pendingRequest || controller.signal.aborted) return;
    pendingRequest = true; $("checkGatewayTest").disabled = true;
    if (manual) message.textContent = "Conferindo o pagamento diretamente na BlackCat...";
    try {
      const data = await read(await fetch(`/api/admin/gateway/charges/${encodeURIComponent(requestId)}`, { cache: "no-store", signal: controller.signal }));
      render(data);
      message.textContent = ["CREATING", "UNKNOWN"].includes(data.data.status)
        ? "A criação ainda não foi confirmada. Consulte este teste antes de gerar outra cobrança."
        : "Situação conferida no servidor. Este teste não entra nas vendas de produtos.";
      if (data.data.status === "PENDING" && !$("gatewayChargeCode").value && $("gatewayChargeQr").hidden && $("gatewayChargeInvoice").hidden) {
        message.textContent = "A cobrança foi identificada, mas os dados do QR Code não chegaram. Localize o teste na BlackCat pelo ID antes de gerar outra cobrança.";
      }
    } catch (error) {
      if (error.name === "AbortError") return;
      message.textContent = error.message;
      if (error.status === 404) {
        fields.disabled = false;
        // Reuse the same request ID if a retry is needed after a lost response.
        $("gatewayTestConsent").checked = false;
      } else schedule();
    } finally { pendingRequest = false; if (!controller.signal.aborted) $("checkGatewayTest").disabled = false; }
  }
  form.addEventListener("submit", async event => {
    event.preventDefault();
    if (pendingRequest || !form.reportValidity()) return;
    remember(requestId || crypto.randomUUID());
    const payload = { requestId, amount: $("gatewayTestAmount").value.trim(), acknowledgeRealCharge: $("gatewayTestConsent").checked,
      customer: { name: $("gatewayTestName").value.trim(), email: $("gatewayTestEmail").value.trim(), phone: $("gatewayTestPhone").value.trim(), document: $("gatewayTestDocument").value.trim() } };
    pendingRequest = true; fields.disabled = true; result.hidden = true;
    message.textContent = "Gerando uma cobrança real na BlackCat. Aguarde...";
    try {
      const data = await read(await fetch("/api/admin/gateway/charges", { method: "POST", headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf }, body: JSON.stringify(payload), signal: controller.signal }));
      render(data);
      message.textContent = "Cobrança de teste criada. Pague somente se quiser validar o recebimento.";
    } catch (error) {
      if (error.name === "AbortError") return;
      message.textContent = error.message;
      if (error.noChargeCreated || (error.status >= 400 && error.status < 500 && !error.creationUncertain)) {
        fields.disabled = false; $("gatewayTestConsent").checked = false; remember(null);
      } else {
        result.hidden = false; $("gatewayChargeState").textContent = "Resultado da criação ainda não confirmado";
        $("gatewayChargeQr").hidden = true; $("gatewayChargeCode").value = "";
        $("copyGatewayTest").disabled = true; $("gatewayChargeInvoice").hidden = true; $("newGatewayTest").hidden = true;
        schedule();
      }
    } finally { pendingRequest = false; }
  }, { signal: controller.signal });
  $("checkGatewayTest").onclick = () => check();
  $("copyGatewayTest").onclick = async () => {
    try { await navigator.clipboard.writeText($("gatewayChargeCode").value); message.textContent = "Código Pix copiado."; }
    catch { $("gatewayChargeCode").focus(); $("gatewayChargeCode").select(); message.textContent = "Selecione e copie o código Pix manualmente."; }
  };
  $("newGatewayTest").onclick = () => {
    clearTimeout(timer); remember(null); fields.disabled = false; $("gatewayTestConsent").checked = false;
    result.hidden = true; message.textContent = "Preencha os dados para um novo teste. Cada envio gera uma cobrança real.";
    $("gatewayTestAmount").focus();
  };
  try { requestId = sessionStorage.getItem(storageKey); } catch {}
  if (requestId) check();
};
