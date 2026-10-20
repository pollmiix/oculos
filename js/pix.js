(function (global) {
  function crc16(str) {
    let crc = 0xffff;
    for (let i = 0; i < str.length; i += 1) {
      crc ^= str.charCodeAt(i) << 8;
      for (let j = 0; j < 8; j += 1) {
        crc = crc & 0x8000 ? (crc << 1) ^ 0x1021 : crc << 1;
        crc &= 0xffff;
      }
    }
    return crc.toString(16).toUpperCase().padStart(4, "0");
  }

  function emv(id, value) {
    const texto = String(value);
    return id + String(texto.length).padStart(2, "0") + texto;
  }

  function limpar(texto, max) {
    return String(texto || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^A-Za-z0-9 ]/g, "")
      .substring(0, max)
      .trim()
      .toUpperCase();
  }

  function validarCpf(valor) {
    const cpf = String(valor || "").replace(/\D/g, "");
    if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;
    for (let posicao = 9; posicao < 11; posicao += 1) {
      let soma = 0;
      for (let i = 0; i < posicao; i += 1) soma += Number(cpf[i]) * (posicao + 1 - i);
      const digito = (soma * 10) % 11 % 10;
      if (Number(cpf[posicao]) !== digito) return false;
    }
    return true;
  }

  function validarCnpj(valor) {
    const cnpj = String(valor || "").replace(/\D/g, "");
    if (cnpj.length !== 14 || /^(\d)\1{13}$/.test(cnpj)) return false;
    const calcularDigito = (base, pesos) => {
      const soma = pesos.reduce((total, peso, indice) => total + Number(base[indice]) * peso, 0);
      const resto = soma % 11;
      return resto < 2 ? 0 : 11 - resto;
    };
    const primeiro = calcularDigito(cnpj, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
    const segundo = calcularDigito(cnpj, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
    return Number(cnpj[12]) === primeiro && Number(cnpj[13]) === segundo;
  }

  function validarChave(tipo, chave) {
    const valor = String(chave || "").trim();
    if (!valor) return false;
    switch (String(tipo || "").toLowerCase()) {
      case "cpf":
        return validarCpf(valor);
      case "cnpj":
        return validarCnpj(valor);
      case "telefone": {
        const digitos = valor.replace(/\D/g, "");
        return /^[+]?[\d\s().-]+$/.test(valor) && [10, 11, 12, 13].includes(digitos.length);
      }
      case "e-mail":
      case "email":
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(valor);
      case "aleatória":
      case "aleatoria":
        return /^[\da-f]{8}-?[\da-f]{4}-?[\da-f]{4}-?[\da-f]{4}-?[\da-f]{12}$/i.test(valor);
      default:
        return valor.length <= 77;
    }
  }

  function gerarPayload(opcoes) {
    const chave = String(opcoes.chave || "").trim();
    const nome = limpar(opcoes.nomeRecebedor || "LOJA", 25) || "LOJA";
    const cidade = limpar(opcoes.cidade || "BRASIL", 15) || "BRASIL";
    const txid = String(opcoes.txid || "***").replace(/[^A-Za-z0-9]/g, "").substring(0, 25) || "***";
    const valor = Number(opcoes.valor || 0);

    const conta = emv("00", "br.gov.bcb.pix") + emv("01", chave);
    let payload = "";
    payload += emv("00", "01");
    payload += emv("01", "11");
    payload += emv("26", conta);
    payload += emv("52", "0000");
    payload += emv("53", "986");
    if (valor > 0) payload += emv("54", valor.toFixed(2));
    payload += emv("58", "BR");
    payload += emv("59", nome);
    payload += emv("60", cidade);
    payload += emv("62", emv("05", txid));
    payload += "6304";
    payload += crc16(payload);
    return payload;
  }

  global.PixBR = { gerarPayload, validarChave };
})(window);
