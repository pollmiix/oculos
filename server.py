import hmac
import csv
import hashlib
import json
import os
import re
import sqlite3
import threading
import time
import uuid
from http.cookies import SimpleCookie
from io import StringIO
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, unquote, urlparse
from urllib.request import Request, urlopen
from urllib.parse import quote
from xml.sax.saxutils import escape

import database


ROOT = Path(__file__).resolve().parent
DATA_DIR = ROOT / ".data"
STORE_FILE = DATA_DIR / "store.json"
TRANSACTIONS_FILE = DATA_DIR / "transactions.json"
BLACKCAT_API = "https://api.blackcatoficial.com/api"
MAX_BODY_SIZE = 8 * 1024 * 1024
state_lock = threading.Lock()
rate_lock = threading.Lock()
rate_limits = {}


def load_env_file():
    env_file = ROOT / ".env"
    if not env_file.exists():
        return
    for line in env_file.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip("\"'"))


def send_json(handler, status, value, headers=None):
    body = json.dumps(value, ensure_ascii=False).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(body)))
    handler.send_header("Cache-Control", "no-store")
    handler.send_header("X-Content-Type-Options", "nosniff")
    for key, header_value in (headers or {}).items():
        handler.send_header(key, header_value)
    handler.end_headers()
    handler.wfile.write(body)


def csv_safe(value):
    if not isinstance(value, str):
        return value
    return "'" + value if value.lstrip().startswith(("=", "+", "-", "@", "\t", "\r")) else value


def safe_store(value):
    public = dict(value)
    public.pop("senhaAdmin", None)
    payment = dict(public.get("pagamento") or {})
    gateway = dict(payment.get("gateway") or {})
    for key in list(gateway):
        normalized_key = key.lower().replace("_", "")
        if any(word in normalized_key for word in ("private", "privad", "secret", "segred", "token", "apikey", "chaveapi")):
            gateway.pop(key, None)
    payment["gateway"] = gateway
    public["pagamento"] = payment
    return public


def read_store():
    stored = database.get_setting("store")
    if stored is not None:
        return stored
    try:
        with state_lock:
            return json.loads(STORE_FILE.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return None
    except (OSError, json.JSONDecodeError):
        return None


def migrate_legacy_store():
    if database.get_setting("store") is not None:
        return
    legacy = read_store()
    if isinstance(legacy, dict) and isinstance(legacy.get("loja"), dict) and isinstance(legacy.get("produtos"), list):
        database.put_setting("store", safe_store(legacy))


def migrate_store_identity():
    store = database.get_setting("store")
    if not isinstance(store, dict) or not isinstance(store.get("loja"), dict):
        return
    identity = store["loja"]
    old_values = {
        "razaoSocial": ("PROVEDOR DE INTERNET MINEIRO NET UAI LTDA", "Vemari Otica LTDA"),
        "whatsapp": ("5531999999999", "5511962217480"),
        "telefone": ("(31) 99999-9999", "(11) 2440-6457"),
        "email": ("contato@mineironetuai.com.br", "itagrs@terra.com.br"),
        "endereco": ("Minas Gerais, Brasil", "Rua Gabriel Machado, 49, Centro, Guarulhos - SP, CEP 07011-070"),
        "horario": ("Seg a Sáb · 8h às 18h", "")
    }
    changed = False
    for key, (old, new) in old_values.items():
        if identity.get(key) == old:
            identity[key] = new
            changed = True
    pix = store.get("pix")
    if isinstance(pix, dict) and pix.get("nomeRecebedor") == "MINEIRO NET UAI LTDA":
        pix["nomeRecebedor"] = ""
        pix["cidade"] = ""
        changed = True
    if changed:
        database.put_setting("store", safe_store(store))


def write_json_atomic(path, value):
    DATA_DIR.mkdir(exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    temporary.replace(path)


def load_transactions():
    try:
        with state_lock:
            value = json.loads(TRANSACTIONS_FILE.read_text(encoding="utf-8"))
            return value if isinstance(value, dict) else {}
    except (FileNotFoundError, OSError, json.JSONDecodeError):
        return {}


def too_many_requests(client_ip, bucket, limit, window_seconds):
    now = time.time()
    with rate_lock:
        recent = [stamp for stamp in rate_limits.get((client_ip, bucket), []) if now - stamp < window_seconds]
        if len(recent) >= limit:
            rate_limits[(client_ip, bucket)] = recent
            return True
        recent.append(now)
        rate_limits[(client_ip, bucket)] = recent
        return False


def required_text(value, label, maximum=200):
    if not isinstance(value, str) or not value.strip() or len(value.strip()) > maximum:
        raise ValueError(f"Confira o campo {label}.")
    return value.strip()


def consented_analytics_session(value):
    if not value:
        return None
    try:
        normalized = str(uuid.UUID(str(value)))
    except (ValueError, TypeError, AttributeError):
        return None
    return normalized if database.has_consented_session(normalized) else None


def money_in_cents(value):
    try:
        amount = Decimal(str(value))
    except (InvalidOperation, ValueError):
        raise ValueError("O preço de um produto não é válido.") from None
    if not amount.is_finite() or amount <= 0:
        raise ValueError("O preço de um produto não é válido.")
    return int((amount * 100).quantize(Decimal("1"), rounding=ROUND_HALF_UP))

def pix_price_in_cents(product):
    price_cents = money_in_cents(product.get("preco") if isinstance(product, dict) else product)
    if isinstance(product, dict) and product.get("aplicarDescontoPix") is not False:
        discount = {"Óculos inteligentes": 15, "Armações femininas": 10, "Armações masculinas": 10, "Outros óculos de grau": 10}.get(product.get("categoria"), 0)
        return int((Decimal(price_cents) * Decimal(100 - discount) / 100).quantize(Decimal("1"), rounding=ROUND_HALF_UP))
    return price_cents


def call_blackcat(path, method, api_key, payload=None):
    body = None if payload is None else json.dumps(payload, ensure_ascii=False).encode("utf-8")
    headers = {"X-API-Key": api_key, "Accept": "application/json"}
    if body is not None:
        headers["Content-Type"] = "application/json"
    request = Request(f"{BLACKCAT_API}{path}", data=body, headers=headers, method=method)
    try:
        with urlopen(request, timeout=25) as response:
            response_body = response.read(1024 * 1024)
            parsed = json.loads(response_body)
            return response.status, parsed
    except HTTPError as error:
        try:
            details = json.loads(error.read(256 * 1024))
            message = details.get("message") if isinstance(details, dict) else None
        except (OSError, json.JSONDecodeError):
            message = None
        return error.code, {"message": message or "O gateway recusou a solicitação."}
    except (URLError, TimeoutError, json.JSONDecodeError) as error:
        raise RuntimeError("Não foi possível confirmar a resposta da BlackCat. Tente novamente mais tarde.") from error


class StoreHandler(SimpleHTTPRequestHandler):
    def log_message(self, format_string, *args):
        # Do not write request IP addresses or paths (which may contain personal data) to logs.
        return

    def end_headers(self):
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Referrer-Policy", "strict-origin-when-cross-origin")
        self.send_header("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
        self.send_header("Cross-Origin-Opener-Policy", "same-origin")
        if self.headers.get("X-Forwarded-Proto", "").lower() == "https":
            self.send_header("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
        super().end_headers()

    def send_document(self, content_type, content, status=200):
        body = content.encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "public, max-age=3600")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        path = unquote(urlparse(self.path).path)
        public_base = os.environ.get("PUBLIC_BASE_URL", "").strip().rstrip("/")
        parsed_base = urlparse(public_base)
        if path == "/robots.txt":
            content = "User-agent: *\nAllow: /\nDisallow: /admin.html\nDisallow: /api/\n"
            if parsed_base.scheme == "https" and parsed_base.netloc:
                content += f"Sitemap: {public_base}/sitemap.xml\n"
            self.send_document("text/plain; charset=utf-8", content)
            return
        if path == "/sitemap.xml":
            if parsed_base.scheme != "https" or not parsed_base.netloc:
                self.send_document("text/plain; charset=utf-8", "Configure PUBLIC_BASE_URL com o domínio HTTPS público da loja.\n", 503)
                return
            urls = ["/", "/contato.html", "/entrega.html", "/pagamento-e-reembolso.html",
                    "/privacidade.html", "/termos-de-uso.html", "/trocas-e-devolucoes.html"]
            store = read_store() or database.get_setting("store") or {}
            products = store.get("produtos", []) if isinstance(store.get("produtos", []), list) else []
            if not products:
                catalog_text = (ROOT / "js" / "config.js").read_text(encoding="utf-8")
                catalog_text += (ROOT / "js" / "catalogo-coliseu.js").read_text(encoding="utf-8")
                products = [{"id": product_id} for product_id in re.findall(r'["\']?id["\']?\s*:\s*["\']([^"\']+)["\']', catalog_text)]
            for product in products:
                if isinstance(product, dict) and product.get("id"):
                    urls.append(f"/produto.html?id={quote(str(product['id']), safe='')}")
            entries = "\n".join(f"  <url><loc>{escape(public_base + path_item)}</loc></url>" for path_item in urls)
            xml = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + entries + "\n</urlset>\n"
            self.send_document("application/xml; charset=utf-8", xml)
            return
        segments = [segment.lower() for segment in path.split("/") if segment]
        if any(segment.startswith(".") for segment in segments) or any(
                segment in {"server.py", "database.py"} or segment.endswith((".sqlite", ".sqlite3", ".db"))
                for segment in segments):
            send_json(self, 404, {"error": "Não encontrado."})
            return
        if path == "/api/health":
            with database.connect() as db:
                admin_configured = db.execute("SELECT 1 FROM admins LIMIT 1").fetchone() is not None
            send_json(self, 200, {"ok": True, "paymentConfigured": bool(os.environ.get("BLACKCAT_API_KEY")),
                                 "adminConfigured": admin_configured})
            return
        if path == "/api/admin/session":
            self.admin_session()
            return
        if path == "/api/admin/dashboard":
            if self.require_admin() is not None:
                try:
                    days = max(1, min(365, int(parse_qs(urlparse(self.path).query).get("days", ["30"])[0])))
                except (TypeError, ValueError):
                    days = 30
                send_json(self, 200, database.dashboard(days))
            return
        if path == "/api/admin/orders":
            if self.require_admin(roles=("owner",)) is not None:
                send_json(self, 200, {"orders": database.list_orders()})
            return
        if path == "/api/admin/customers":
            if self.require_admin(roles=("owner",)) is not None:
                send_json(self, 200, {"customers": database.list_customers()})
            return
        if path == "/api/admin/products":
            if self.require_admin(roles=("owner",)) is not None:
                send_json(self, 200, {"products": database.product_report()})
            return
        if path == "/api/admin/accounts":
            if self.require_admin(roles=("owner",)) is not None:
                send_json(self, 200, {"accounts": database.list_admins()})
            return
        if path == "/api/admin/analytics":
            if self.require_admin() is not None:
                self.admin_analytics()
            return
        if path == "/api/admin/export.csv":
            if self.require_admin(roles=("owner",)) is not None:
                self.admin_export()
            return
        if path == "/api/store":
            store = read_store()
            if store is None:
                send_json(self, 404, {"error": "A loja ainda não foi sincronizada com o servidor."})
                return
            send_json(self, 200, safe_store(store))
            return
        match = re.fullmatch(r"/api/payments/([A-Za-z0-9_-]{1,100})", path)
        if match:
            self.get_payment_status(match.group(1))
            return
        super().do_GET()

    def do_POST(self):
        path = urlparse(self.path).path
        if path == "/api/admin/login":
            self.admin_login()
            return
        if path == "/api/admin/logout":
            session = self.require_admin(write=True)
            if session is not None:
                token = self.admin_token()
                database.audit(session["admin_id"], "logout", "session")
                database.delete_session(token)
                send_json(self, 200, {"success": True}, {"Set-Cookie": self.session_cookie("", expired=True)})
            return
        if path == "/api/admin/store":
            self.save_store()
            return
        if path == "/api/admin/accounts":
            self.create_analyst()
            return
        if path == "/api/events":
            self.collect_event()
            return
        if path == "/api/orders/manual":
            self.create_manual_order()
            return
        match = re.fullmatch(r"/api/admin/orders/([A-Za-z0-9_-]{1,100})", path)
        if match:
            if self.require_admin(write=True, roles=("owner",)) is not None:
                self.update_order(match.group(1))
            return
        if path == "/api/payments/blackcat":
            self.create_blackcat_payment()
            return
        send_json(self, 404, {"error": "Não encontrado."})

    def do_DELETE(self):
        match = re.fullmatch(r"/api/admin/accounts/(\d+)", urlparse(self.path).path)
        if not match:
            send_json(self, 404, {"error": "Nao encontrado."})
            return
        session = self.require_admin(write=True, roles=("owner",))
        if not session:
            return
        account_id = int(match.group(1))
        if not database.delete_analyst(account_id):
            send_json(self, 404, {"error": "Conta de analise nao encontrada."})
            return
        database.audit(session["admin_id"], "account_deleted", "admin", account_id)
        send_json(self, 200, {"success": True})

    def read_json_body(self, limit=MAX_BODY_SIZE):
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            raise ValueError("Corpo da solicitação inválido.") from None
        if length < 1 or length > limit:
            raise ValueError("A solicitação está vazia ou excede o limite permitido.")
        try:
            value = json.loads(self.rfile.read(length))
        except (json.JSONDecodeError, UnicodeDecodeError):
            raise ValueError("Envie os dados em formato JSON válido.") from None
        if not isinstance(value, dict):
            raise ValueError("O formato dos dados enviados não é válido.")
        return value

    def admin_token(self):
        cookie = SimpleCookie()
        try:
            cookie.load(self.headers.get("Cookie", ""))
        except Exception:
            return ""
        morsel = cookie.get("mn_admin")
        return morsel.value if morsel else ""

    def session_cookie(self, token, expired=False):
        secure = "; Secure" if self.headers.get("X-Forwarded-Proto", "").lower() == "https" else ""
        if expired:
            return f"mn_admin=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0{secure}"
        return f"mn_admin={token}; Path=/; HttpOnly; SameSite=Strict; Max-Age={database.SESSION_SECONDS}{secure}"

    def require_admin(self, write=False, roles=None):
        session = database.session_for_token(self.admin_token())
        if not session:
            send_json(self, 401, {"error": "Entre no painel administrativo para continuar."})
            return None
        if roles and session["role"] not in roles:
            send_json(self, 403, {"error": "Sua conta não tem permissão para esta ação."})
            return None
        if write and not hmac.compare_digest(self.headers.get("X-CSRF-Token", ""), session["csrf_token"]):
            send_json(self, 403, {"error": "A sessão expirou. Atualize o painel e tente novamente."})
            return None
        return session

    def admin_login(self):
        if too_many_requests(self.client_address[0], "admin-login", 8, 300):
            send_json(self, 429, {"error": "Muitas tentativas de acesso. Aguarde alguns minutos."})
            return
        try:
            data = self.read_json_body(16 * 1024)
            username = required_text(data.get("username", ""), "usuário", 100)
            password = data.get("password")
            if not isinstance(password, str) or not password or len(password) > 500:
                raise ValueError("Confira o campo senha.")
        except ValueError as error:
            send_json(self, 400, {"error": str(error)})
            return
        with database.connect() as db:
            configured = db.execute("SELECT 1 FROM admins LIMIT 1").fetchone() is not None
        if not configured:
            send_json(self, 503, {"error": "O administrador ainda não foi configurado. Defina ADMIN_USERNAME e ADMIN_PASSWORD no ambiente do servidor e reinicie-o."})
            return
        session = database.authenticate(username, password)
        if not session:
            send_json(self, 401, {"error": "Usuário ou senha incorretos. Verifique a configuração do servidor."})
            return
        database.audit(session["admin"]["id"], "login", "session")
        send_json(self, 200, {"success": True, "csrfToken": session["csrfToken"], "admin": session["admin"]},
                  {"Set-Cookie": self.session_cookie(session["token"])})

    def admin_session(self):
        session = database.session_for_token(self.admin_token())
        if not session:
            send_json(self, 401, {"error": "Sessão administrativa encerrada."})
            return
        send_json(self, 200, {"success": True, "csrfToken": session["csrf_token"],
                              "admin": {"id": session["admin_id"], "username": session["username"], "role": session["role"]}})

    def admin_analytics(self):
        query = parse_qs(urlparse(self.path).query)
        try:
            days = int(query.get("days", ["30"])[0])
        except (ValueError, TypeError):
            days = 30
        days = max(1, min(days, 365))
        end = int(time.time())
        filters = {key: query.get(key, [""])[0] for key in ("page", "product", "source", "device")}
        send_json(self, 200, database.analytics_summary(end - (days - 1) * 86400, end, filters))

    def admin_export(self):
        query = parse_qs(urlparse(self.path).query)
        kind = query.get("kind", ["orders"])[0]
        output = StringIO(newline="")
        writer = csv.writer(output)
        if kind == "orders":
            writer.writerow(["pedido", "criado_em_utc", "status", "pagamento", "metodo", "total_centavos", "cliente", "email", "telefone", "itens"])
            for order in database.list_orders(5000):
                customer = order["customer"]
                writer.writerow([csv_safe(value) for value in [order["id"], order["created_at"], order["status"], order["payment_status"],
                                 order["payment_method"], order["total_cents"], customer.get("name", ""),
                                 customer.get("email", ""), customer.get("phone", ""),
                                 json.dumps(order["items"], ensure_ascii=False)]])
        elif kind == "products":
            writer.writerow(["produto_id", "nome", "categoria", "preco_centavos", "estoque", "unidades_pagas"])
            for product in database.product_report():
                writer.writerow([csv_safe(product.get("id", "")), csv_safe(product.get("name", "")),
                                 csv_safe(product.get("category", "")), product.get("priceCents"),
                                 product.get("stock"), product.get("paidUnits")])
        elif kind == "traffic":
            writer.writerow(["data_unix_utc", "evento", "sessao_anonima", "pagina", "produto", "origem", "dispositivo", "navegador"])
            try:
                days = max(1, min(365, int(query.get("days", ["30"])[0])))
            except (TypeError, ValueError):
                days = 30
            start = int(time.time()) - (days - 1) * 86400
            with database.connect() as db:
                rows = db.execute("SELECT happened_at,event_name,session_id,page_path,product_id,source,device,browser FROM events WHERE happened_at>=? ORDER BY happened_at DESC", (start,)).fetchall()
            writer.writerows([[csv_safe(value) for value in tuple(row)] for row in rows])
        else:
            send_json(self, 400, {"error": "Tipo de exportação inválido."})
            return
        body = output.getvalue().encode("utf-8-sig")
        self.send_response(200)
        self.send_header("Content-Type", "text/csv; charset=utf-8")
        self.send_header("Content-Disposition", f"attachment; filename=loja-{kind}.csv")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def collect_event(self):
        if too_many_requests(self.client_address[0], "analytics", 120, 60):
            send_json(self, 429, {"error": "Aguarde antes de enviar novos eventos."})
            return
        try:
            data = self.read_json_body(12 * 1024)
            name = data.get("name")
            if name not in {"page_view", "view_item", "search", "click_buy", "add_to_cart", "begin_checkout"}:
                raise ValueError("Evento inválido.")
            session_id = str(uuid.UUID(str(data.get("sessionId", ""))))
            page_path = str(data.get("page", "/"))[:240]
            if not page_path.startswith("/") or "?" in page_path or "#" in page_path:
                raise ValueError("Página inválida.")
            product_id = str(data.get("productId", ""))[:120] or None
            source = str(data.get("source", "direct"))[:180]
            device = str(data.get("device", "unknown"))[:30]
            browser = str(data.get("browser", "unknown"))[:30]
            database.record_event(name, session_id, page_path, product_id, source, device, browser)
        except (ValueError, TypeError, sqlite3.Error) as error:
            send_json(self, 400, {"error": str(error) or "Evento inválido."})
            return
        send_json(self, 202, {"accepted": True})

    def create_manual_order(self):
        if too_many_requests(self.client_address[0], "manual-order", 12, 600):
            send_json(self, 429, {"error": "Muitas tentativas de envio. Aguarde e tente novamente."})
            return
        store = read_store()
        if store is None:
            send_json(self, 503, {"error": "A loja ainda não está configurada no servidor."})
            return
        try:
            data = self.read_json_body(64 * 1024)
            customer = data.get("customer")
            requested_items = data.get("items")
            if not isinstance(customer, dict) or not isinstance(requested_items, list) or not requested_items:
                raise ValueError("Dados do pedido incompletos.")
            name = required_text(customer.get("name"), "nome", 120)
            email = str(customer.get("email", "")).strip()[:254]
            phone = re.sub(r"\D", "", str(customer.get("phone", "")))
            if email and not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", email):
                raise ValueError("Informe um e-mail válido.")
            if not 10 <= len(phone) <= 13:
                raise ValueError("Informe um telefone válido com DDD.")
            shipping = data.get("shipping") if isinstance(data.get("shipping"), dict) else {}
            safe_customer = {"name": name, "email": email, "phone": phone,
                             "shipping": {key: str(shipping.get(key, "")).strip()[:200]
                                          for key in ("street", "number", "complement", "neighborhood", "city", "state", "zipCode")}}
            products = {str(product.get("id")): product for product in store.get("produtos", []) if isinstance(product, dict)}
            items = []
            total_cents = 0
            for requested in requested_items[:50]:
                product = products.get(str(requested.get("id", "")))
                if not product:
                    raise ValueError("Um produto não está mais disponível no catálogo.")
                quantity = int(requested.get("quantity", 0))
                if quantity < 1 or quantity > int(product.get("estoque", 0)):
                    raise ValueError("Confira a quantidade e disponibilidade dos produtos.")
                price = pix_price_in_cents(product)
                total_cents += price * quantity
                items.append({"id": str(product["id"]), "name": required_text(product.get("nome"), "produto", 200),
                              "quantity": quantity, "unitPriceCents": price})
            if total_cents < 1:
                raise ValueError("O total do pedido não é válido.")
        except (ValueError, TypeError) as error:
            send_json(self, 400, {"error": str(error)})
            return
        order_id = "MN" + uuid.uuid4().hex[:16].upper()
        try:
            analytics_session_id = consented_analytics_session(data.get("analyticsSessionId"))
            database.create_order(order_id, None, "awaiting_payment_confirmation", "reported", "pix_manual",
                                  total_cents, safe_customer, items, analytics_session_id)
        except sqlite3.Error:
            send_json(self, 500, {"error": "Não foi possível registrar o pedido. Tente novamente."})
            return
        send_json(self, 201, {"success": True, "orderId": order_id, "paymentStatus": "reported"})

    def update_order(self, order_id):
        try:
            data = self.read_json_body(8 * 1024)
            status = data.get("paymentStatus")
            if status not in {"pending", "paid", "cancelled", "refunded", "reported"}:
                raise ValueError("Status de pagamento inválido.")
            if not database.admin_update_order(order_id, status):
                send_json(self, 404, {"error": "Pedido nao encontrado."})
                return
            session = self.require_admin(write=False)
            if session:
                database.audit(session["admin_id"], "payment_status_changed", "order", order_id)
            send_json(self, 200, {"success": True})
        except ValueError as error:
            send_json(self, 400, {"error": str(error)})

    def send_json(self, status, value, headers=None):
        body = json.dumps(value, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        for key, header_value in (headers or {}).items():
            self.send_header(key, header_value)
        self.end_headers()
        self.wfile.write(body)

    def save_store(self):
        session = self.require_admin(write=True, roles=("owner",))
        if not session:
            return
        try:
            value = self.read_json_body()
            if not isinstance(value.get("loja"), dict) or not isinstance(value.get("produtos"), list):
                raise ValueError("Dados da loja ou do catálogo não estão válidos.")
            if len(value["produtos"]) > 500:
                raise ValueError("O catálogo excede o limite de produtos do servidor.")
            payment = value.get("pagamento")
            if payment is not None and (not isinstance(payment, dict) or payment.get("metodo") not in ("pix", "gateway")):
                raise ValueError("Escolha PIX ou gateway como forma de pagamento.")
            database.put_setting("store", safe_store(value))
            database.audit(session["admin_id"], "store_updated", "store")
        except ValueError as error:
            send_json(self, 400, {"error": str(error)})
            return
        except OSError:
            send_json(self, 500, {"error": "Não foi possível gravar as configurações no servidor."})
            return
        send_json(self, 200, {"success": True})

    def create_analyst(self):
        session = self.require_admin(write=True, roles=("owner",))
        if not session:
            return
        if too_many_requests(self.client_address[0], f"create-analyst-{session['admin_id']}", 10, 3600):
            send_json(self, 429, {"error": "Muitas tentativas de criacao de conta. Tente novamente mais tarde."})
            return
        try:
            data = self.read_json_body(16 * 1024)
            username = required_text(data.get("username", ""), "username", 50)
            password = data.get("password")
            if not re.fullmatch(r"[A-Za-z0-9._-]{3,50}", username):
                raise ValueError("Use de 3 a 50 caracteres: letras, numeros, ponto, hifen ou sublinhado.")
            if not isinstance(password, str) or len(password) < 12 or len(password) > 500:
                raise ValueError("A senha deve ter pelo menos 12 caracteres.")
            admin_id = database.create_analyst(username, password)
        except sqlite3.IntegrityError:
            send_json(self, 409, {"error": "Esse usuario ja existe."})
            return
        except ValueError as error:
            send_json(self, 400, {"error": str(error)})
            return
        database.audit(session["admin_id"], "account_created", "admin", admin_id)
        send_json(self, 201, {"success": True, "account": {"id": admin_id, "username": username, "role": "analyst"}})

    def create_blackcat_payment(self):
        if too_many_requests(self.client_address[0], "create", 8, 60):
            send_json(self, 429, {"error": "Muitas tentativas. Aguarde um minuto e tente novamente."})
            return
        api_key = os.environ.get("BLACKCAT_API_KEY", "").strip()
        if not api_key:
            send_json(self, 503, {"error": "O gateway não está configurado no servidor."})
            return
        store = read_store()
        if store is None or (store.get("pagamento") or {}).get("metodo") != "gateway":
            send_json(self, 409, {"error": "A loja ainda não ativou o gateway no painel sincronizado."})
            return
        try:
            request_data = self.read_json_body(128 * 1024)
            customer = request_data.get("customer")
            shipping = request_data.get("shipping")
            requested_items = request_data.get("items")
            analytics_session_id = consented_analytics_session(request_data.get("analyticsSessionId"))
            if not isinstance(customer, dict) or not isinstance(shipping, dict):
                raise ValueError("Preencha os dados do cliente e o endereço de envio.")
            if not isinstance(requested_items, list) or not requested_items or len(requested_items) > 50:
                raise ValueError("O carrinho está vazio ou contém itens demais.")
            name = required_text(customer.get("name"), "nome", 120)
            email = required_text(customer.get("email"), "e-mail", 254)
            if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", email):
                raise ValueError("Informe um e-mail válido.")
            phone = re.sub(r"\D", "", str(customer.get("phone", "")))
            if not 10 <= len(phone) <= 13:
                raise ValueError("Informe um telefone válido com DDD.")
            document = re.sub(r"\D", "", str((customer.get("document") or {}).get("number", "")))
            if len(document) != 11:
                raise ValueError("Informe um CPF válido para o pagamento.")
            address = {
                "name": name,
                "street": required_text(shipping.get("street"), "rua", 200),
                "number": required_text(shipping.get("number"), "número", 30),
                "complement": str(shipping.get("complement", "")).strip()[:120],
                "neighborhood": required_text(shipping.get("neighborhood"), "bairro", 120),
                "city": required_text(shipping.get("city"), "cidade", 120),
                "state": required_text(shipping.get("state"), "estado", 2).upper(),
                "zipCode": re.sub(r"\D", "", str(shipping.get("zipCode", "")))
            }
            if len(address["state"]) != 2 or len(address["zipCode"]) != 8:
                raise ValueError("Confira o estado e o CEP do endereço de entrega.")
            products = {str(product.get("id")): product for product in store["produtos"] if isinstance(product, dict)}
            sale_items = []
            order_items = []
            total_cents = 0
            for requested in requested_items:
                product_id = str(requested.get("id", ""))
                product = products.get(product_id)
                if product is None:
                    raise ValueError("Um produto do carrinho não está no catálogo atual. Atualize a página e tente novamente.")
                try:
                    quantity = int(requested.get("quantity", 0))
                    stock = int(product.get("estoque", 0))
                except (TypeError, ValueError):
                    raise ValueError("A quantidade de um produto não é válida.") from None
                if quantity < 1 or quantity > stock:
                    raise ValueError(f"Estoque insuficiente para {product.get('nome', 'um produto')}.")
                unit_price = pix_price_in_cents(product)
                total_cents += unit_price * quantity
                sale_items.append({
                    "title": required_text(product.get("nome"), "nome do produto", 200),
                    "unitPrice": unit_price,
                    "quantity": quantity,
                    "tangible": True
                })
                order_items.append({"id": product_id, "name": sale_items[-1]["title"],
                                    "quantity": quantity, "unitPriceCents": unit_price})
            if total_cents < 1:
                raise ValueError("O total do pedido não é válido.")
        except ValueError as error:
            send_json(self, 400, {"error": str(error)})
            return
        external_ref = f"MN{uuid.uuid4().hex[:24].upper()}"
        sale_payload = {
            "amount": total_cents,
            "currency": "BRL",
            "paymentMethod": "pix",
            "items": sale_items,
            "customer": {
                "name": name,
                "email": email,
                "phone": phone,
                "document": {"number": document, "type": "cpf"}
            },
            "shipping": address,
            "pix": {"expiresInDays": 1},
            "externalRef": external_ref
        }
        try:
            status, response = call_blackcat("/sales/create-sale", "POST", api_key, sale_payload)
        except RuntimeError:
            send_json(self, 502, {"error": "Não foi possível contactar a BlackCat. Nenhum resultado de pagamento foi confirmado."})
            return
        transaction = response.get("data") if isinstance(response, dict) else None
        payment_data = transaction.get("paymentData") if isinstance(transaction, dict) else None
        if status not in (200, 201) or not isinstance(transaction, dict) or not transaction.get("transactionId"):
            message = response.get("message") if isinstance(response, dict) else None
            send_json(self, 502, {"error": message or "A BlackCat não criou a cobrança. Confira a configuração do gateway."})
            return
        transaction_id = str(transaction["transactionId"])
        if not isinstance(payment_data, dict):
            payment_data = {}
        transactions = load_transactions()
        transactions[transaction_id] = {
            "amount": total_cents,
            "externalRef": external_ref,
            "createdAt": int(time.time())
        }
        try:
            database.create_order(external_ref, transaction_id, "awaiting_payment", "pending", "blackcat",
                                  total_cents,
                                  {"name": name, "email": email, "phone": phone, "shipping": address},
                                  order_items, analytics_session_id)
        except sqlite3.Error:
            send_json(self, 500, {"error": "A cobrança foi criada, mas o servidor não conseguiu registrar o pedido. Entre em contato com a loja antes de tentar pagar novamente."})
            return
        try:
            with state_lock:
                write_json_atomic(TRANSACTIONS_FILE, transactions)
        except OSError:
            send_json(self, 500, {"error": "A cobrança foi criada, mas o servidor não conseguiu registrar a referência do pedido. Entre em contato com a loja antes de tentar pagar novamente."})
            return
        send_json(self, 201, {
            "success": True,
            "data": {
                "transactionId": transaction_id,
                "status": transaction.get("status", "PENDING"),
                "amount": total_cents,
                "invoiceUrl": transaction.get("invoiceUrl"),
                "paymentData": {
                    "qrCode": payment_data.get("qrCode"),
                    "qrCodeBase64": payment_data.get("qrCodeBase64"),
                    "copyPaste": payment_data.get("copyPaste"),
                    "expiresAt": payment_data.get("expiresAt")
                }
            }
        })

    def get_payment_status(self, transaction_id):
        api_key = os.environ.get("BLACKCAT_API_KEY", "").strip()
        if not api_key:
            send_json(self, 503, {"error": "O gateway não está configurado no servidor."})
            return
        if too_many_requests(self.client_address[0], "status", 60, 60):
            send_json(self, 429, {"error": "Muitas consultas. Aguarde e tente novamente."})
            return
        transaction = load_transactions().get(transaction_id)
        if transaction is None:
            send_json(self, 404, {"error": "Não foi encontrado um pedido correspondente a esta cobrança."})
            return
        try:
            status, response = call_blackcat(
                f"/sales/{unquote(transaction_id)}/status",
                "GET",
                api_key
            )
        except RuntimeError:
            send_json(self, 502, {"error": "Não foi possível consultar o status na BlackCat."})
            return
        data = response.get("data") if isinstance(response, dict) else None
        if status != 200 or not isinstance(data, dict) or data.get("transactionId") != transaction_id:
            send_json(self, 502, {"error": "A BlackCat não confirmou o status desta cobrança."})
            return
        if data.get("amount") != transaction.get("amount"):
            send_json(self, 502, {"error": "O valor confirmado pelo gateway não corresponde ao pedido."})
            return
        state = data.get("status")
        if state not in ("PENDING", "PAID", "CANCELLED", "REFUNDED"):
            send_json(self, 502, {"error": "A BlackCat retornou um status de pagamento desconhecido."})
            return
        database.update_order_payment(transaction_id, state)
        send_json(self, 200, {
            "success": True,
            "data": {
                "transactionId": transaction_id,
                "status": state,
                "amount": data["amount"],
                "paidAt": data.get("paidAt")
            }
        })


if __name__ == "__main__":
    load_env_file()
    database.init_db()
    migrate_legacy_store()
    migrate_store_identity()
    host = os.environ.get("HOST", "127.0.0.1")
    port = int(os.environ.get("PORT", "8000"))
    server = ThreadingHTTPServer((host, port), lambda *args, **kwargs: StoreHandler(*args, directory=str(ROOT), **kwargs))
    print(f"Loja e API disponíveis em http://{host}:{port}")
    print("Configure BLACKCAT_API_KEY e ADMIN_PASSWORD no ambiente do servidor para ativar a integração.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nServidor encerrado.")
    finally:
        server.server_close()
