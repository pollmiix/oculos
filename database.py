"""SQLite persistence, administrator sessions and reporting for the store API."""
import hashlib
import hmac
import json
import os
import secrets
import sqlite3
import time
from contextlib import contextmanager
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from pathlib import Path


ROOT = Path(__file__).resolve().parent
DATA_DIR = Path(os.environ.get("STORE_DATA_DIR", ROOT / ".data")).resolve()
DB_PATH = DATA_DIR / "store.sqlite3"
PBKDF2_ROUNDS = 310_000
SESSION_SECONDS = 8 * 60 * 60


def analytics_retention_days():
    try:
        return max(30, min(365, int(os.environ.get("ANALYTICS_RETENTION_DAYS", "90"))))
    except (TypeError, ValueError):
        return 90


@contextmanager
def connect():
    DATA_DIR.mkdir(exist_ok=True)
    db = sqlite3.connect(DB_PATH, timeout=10)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA foreign_keys=ON")
    db.execute("PRAGMA journal_mode=WAL")
    try:
        yield db
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def _password_hash(password, salt=None):
    salt = salt or secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, PBKDF2_ROUNDS)
    return salt.hex(), digest.hex()


def init_db(default_store=None):
    with connect() as db:
        db.executescript("""
          CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            updated_at INTEGER NOT NULL
          );
          CREATE TABLE IF NOT EXISTS admins (
            id INTEGER PRIMARY KEY,
            username TEXT UNIQUE NOT NULL,
            salt TEXT NOT NULL,
            password_hash TEXT NOT NULL,
            role TEXT NOT NULL DEFAULT 'owner',
            active INTEGER NOT NULL DEFAULT 1,
            created_at INTEGER NOT NULL
          );
          CREATE TABLE IF NOT EXISTS sessions (
            token_hash TEXT PRIMARY KEY,
            admin_id INTEGER NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
            csrf_token TEXT NOT NULL,
            expires_at INTEGER NOT NULL,
            created_at INTEGER NOT NULL
          );
          CREATE TABLE IF NOT EXISTS orders (
            id TEXT PRIMARY KEY,
            transaction_id TEXT UNIQUE,
            analytics_session_id TEXT,
            created_at INTEGER NOT NULL,
            status TEXT NOT NULL,
            payment_status TEXT NOT NULL,
            payment_method TEXT NOT NULL,
            total_cents INTEGER NOT NULL,
            customer_json TEXT NOT NULL,
            items_json TEXT NOT NULL
          );
          CREATE TABLE IF NOT EXISTS events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            event_name TEXT NOT NULL,
            happened_at INTEGER NOT NULL,
            session_id TEXT NOT NULL,
            page_path TEXT NOT NULL,
            product_id TEXT,
            source TEXT,
            device TEXT,
            browser TEXT
          );
          CREATE INDEX IF NOT EXISTS idx_events_date ON events(happened_at);
          CREATE INDEX IF NOT EXISTS idx_events_name ON events(event_name);
          CREATE INDEX IF NOT EXISTS idx_orders_date ON orders(created_at);
          CREATE TABLE IF NOT EXISTS admin_audit (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            admin_id INTEGER NOT NULL REFERENCES admins(id),
            action TEXT NOT NULL,
            entity TEXT NOT NULL,
            entity_id TEXT,
            happened_at INTEGER NOT NULL
          );
        """)
        if db.execute("SELECT 1 FROM settings WHERE key='store'").fetchone() is None and default_store:
            db.execute("INSERT INTO settings(key,value,updated_at) VALUES('store',?,?)",
                       (json.dumps(default_store, ensure_ascii=False), int(time.time())))
        if db.execute("SELECT 1 FROM admins LIMIT 1").fetchone() is None:
            username = os.environ.get("ADMIN_USERNAME", "").strip()
            password = os.environ.get("ADMIN_PASSWORD", "")
            if password and username:
                salt, password_hash = _password_hash(password)
                db.execute("INSERT INTO admins(username,salt,password_hash,role,created_at) VALUES(?,?,?,?,?)",
                           (username, salt, password_hash, "owner", int(time.time())))
        db.execute("DELETE FROM events WHERE happened_at < ?",
                   (int(time.time()) - analytics_retention_days() * 86400,))
        order_columns = {row["name"] for row in db.execute("PRAGMA table_info(orders)")}
        if "analytics_session_id" not in order_columns:
            db.execute("ALTER TABLE orders ADD COLUMN analytics_session_id TEXT")
        admin_columns = {row["name"] for row in db.execute("PRAGMA table_info(admins)")}
        if "active" not in admin_columns:
            db.execute("ALTER TABLE admins ADD COLUMN active INTEGER NOT NULL DEFAULT 1")


def get_setting(key):
    with connect() as db:
        row = db.execute("SELECT value FROM settings WHERE key=?", (key,)).fetchone()
        return json.loads(row["value"]) if row else None


def put_setting(key, value):
    with connect() as db:
        db.execute("INSERT INTO settings(key,value,updated_at) VALUES(?,?,?) "
                   "ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at",
                   (key, json.dumps(value, ensure_ascii=False), int(time.time())))


def authenticate(username, password):
    with connect() as db:
        row = db.execute("SELECT * FROM admins WHERE username=? AND active=1", (username,)).fetchone()
        if not row:
            # Equalize the expensive work for unknown usernames.
            hashlib.pbkdf2_hmac("sha256", str(password).encode("utf-8"), b"store-admin-dummy", PBKDF2_ROUNDS)
            return None
        _, attempted = _password_hash(str(password), bytes.fromhex(row["salt"]))
        if not hmac.compare_digest(attempted, row["password_hash"]):
            return None
        token = secrets.token_urlsafe(32)
        csrf = secrets.token_urlsafe(32)
        expires = int(time.time()) + SESSION_SECONDS
        token_hash = hashlib.sha256(token.encode()).hexdigest()
        db.execute("INSERT INTO sessions(token_hash,admin_id,csrf_token,expires_at,created_at) VALUES(?,?,?,?,?)",
                   (token_hash, row["id"], csrf, expires, int(time.time())))
        return {"token": token, "csrfToken": csrf, "expiresAt": expires,
                "admin": {"id": row["id"], "username": row["username"], "role": row["role"]}}


def list_admins():
    with connect() as db:
        return [dict(row) for row in db.execute("SELECT id,username,role,active,created_at FROM admins ORDER BY created_at").fetchall()]


def create_analyst(username, password):
    salt, password_hash = _password_hash(password)
    with connect() as db:
        db.execute("INSERT INTO admins(username,salt,password_hash,role,created_at) VALUES(?,?,?,?,?)",
                   (username, salt, password_hash, "analyst", int(time.time())))
        return db.execute("SELECT id FROM admins WHERE username=?", (username,)).fetchone()["id"]


def delete_analyst(admin_id):
    with connect() as db:
        cursor = db.execute("UPDATE admins SET active=0 WHERE id=? AND role='analyst' AND active=1", (admin_id,))
        if cursor.rowcount:
            db.execute("DELETE FROM sessions WHERE admin_id=?", (admin_id,))
        return cursor.rowcount > 0


def session_for_token(token):
    if not token:
        return None
    token_hash = hashlib.sha256(token.encode()).hexdigest()
    with connect() as db:
        row = db.execute("SELECT s.*,a.username,a.role FROM sessions s JOIN admins a ON a.id=s.admin_id "
                         "WHERE s.token_hash=?", (token_hash,)).fetchone()
        if not row:
            return None
        if row["expires_at"] <= int(time.time()):
            db.execute("DELETE FROM sessions WHERE token_hash=?", (token_hash,))
            return None
        return dict(row)


def delete_session(token):
    if not token:
        return
    token_hash = hashlib.sha256(token.encode()).hexdigest()
    with connect() as db:
        db.execute("DELETE FROM sessions WHERE token_hash=?", (token_hash,))


def audit(admin_id, action, entity, entity_id=None):
    with connect() as db:
        db.execute("INSERT INTO admin_audit(admin_id,action,entity,entity_id,happened_at) VALUES(?,?,?,?,?)",
                   (admin_id, action[:80], entity[:80], str(entity_id or "")[:120], int(time.time())))


def record_event(name, session_id, page_path, product_id=None, source=None, device=None, browser=None):
    with connect() as db:
        db.execute("INSERT INTO events(event_name,happened_at,session_id,page_path,product_id,source,device,browser) "
                   "VALUES(?,?,?,?,?,?,?,?)",
                   (name, int(time.time()), session_id, page_path, product_id, source, device, browser))
        retention_days = analytics_retention_days()
        db.execute("DELETE FROM events WHERE happened_at < ?", (int(time.time()) - retention_days * 86400,))


def has_consented_session(session_id):
    if not session_id:
        return False
    with connect() as db:
        return db.execute("SELECT 1 FROM events WHERE session_id=? LIMIT 1", (session_id,)).fetchone() is not None


def create_order(order_id, transaction_id, status, payment_status, method, total_cents, customer, items, analytics_session_id=None):
    with connect() as db:
        db.execute("INSERT INTO orders(id,transaction_id,analytics_session_id,created_at,status,payment_status,payment_method,total_cents,customer_json,items_json) "
                   "VALUES(?,?,?,?,?,?,?,?,?,?)",
                   (order_id, transaction_id, analytics_session_id, int(time.time()), status, payment_status, method, total_cents,
                    json.dumps(customer, ensure_ascii=False), json.dumps(items, ensure_ascii=False)))


def update_order_payment(transaction_id, status):
    normalized = str(status).lower()
    order_status = ("paid" if normalized == "paid" else
                    "cancelled" if normalized == "cancelled" else
                    "refunded" if normalized == "refunded" else "awaiting_payment")
    with connect() as db:
        previous = db.execute("SELECT payment_status,analytics_session_id FROM orders WHERE transaction_id=?", (transaction_id,)).fetchone()
        db.execute("UPDATE orders SET payment_status=?,status=? WHERE transaction_id=?",
                   (normalized, order_status, transaction_id))
        if normalized == "paid" and previous and previous["payment_status"] != "paid" and previous["analytics_session_id"]:
            begin = db.execute("SELECT page_path,source,device,browser FROM events WHERE session_id=? ORDER BY happened_at DESC LIMIT 1",
                               (previous["analytics_session_id"],)).fetchone()
            if begin:
                db.execute("INSERT INTO events(event_name,happened_at,session_id,page_path,source,device,browser) VALUES(?,?,?,?,?,?,?)",
                           ("purchase", int(time.time()), previous["analytics_session_id"], "/checkout",
                            begin["source"], begin["device"], begin["browser"]))


def admin_update_order(order_id, status):
    normalized = str(status).lower()
    order_status = ("paid" if normalized == "paid" else
                    "cancelled" if normalized == "cancelled" else
                    "refunded" if normalized == "refunded" else "awaiting_payment")
    with connect() as db:
        previous = db.execute("SELECT payment_status,analytics_session_id FROM orders WHERE id=?", (order_id,)).fetchone()
        if not previous:
            return False
        db.execute("UPDATE orders SET payment_status=?,status=? WHERE id=?", (normalized, order_status, order_id))
        if normalized == "paid" and previous["payment_status"] != "paid" and previous["analytics_session_id"]:
            begin = db.execute("SELECT source,device,browser FROM events WHERE session_id=? ORDER BY happened_at DESC LIMIT 1",
                               (previous["analytics_session_id"],)).fetchone()
            if begin:
                db.execute("INSERT INTO events(event_name,happened_at,session_id,page_path,source,device,browser) VALUES(?,?,?,?,?,?,?)",
                           ("purchase", int(time.time()), previous["analytics_session_id"], "/checkout",
                            begin["source"], begin["device"], begin["browser"]))
        return True


def dashboard(days=30):
    now = int(time.time())
    days = max(1, min(365, int(days)))
    start = now - (days - 1) * 86400
    with connect() as db:
        products = get_setting("store") or {}
        product_list = products.get("produtos", [])
        low_stock = sum(1 for item in product_list
                        if isinstance(item, dict) and str(item.get("estoque", "0")).isdigit()
                        and int(item.get("estoque", 0)) <= 3)
        orders = db.execute("SELECT COUNT(*) AS n, "
                            "SUM(CASE WHEN payment_status='paid' THEN total_cents ELSE 0 END) AS revenue, "
                            "SUM(CASE WHEN payment_status IN ('pending','reported') THEN 1 ELSE 0 END) AS pending, "
                            "SUM(CASE WHEN payment_status='paid' THEN 1 ELSE 0 END) AS paid "
                            "FROM orders WHERE created_at>=?", (start,)).fetchone()
        visitors = db.execute("SELECT COUNT(DISTINCT session_id) AS n FROM events WHERE happened_at>=?", (start,)).fetchone()["n"]
        purchases = orders["paid"] or 0
        conversion = round((purchases / visitors) * 100, 2) if visitors else 0
        sales = db.execute("SELECT strftime('%Y-%m-%d',created_at,'unixepoch') AS day, "
                           "SUM(CASE WHEN payment_status='paid' THEN total_cents ELSE 0 END) AS cents, COUNT(*) AS orders "
                           "FROM orders WHERE created_at>=? GROUP BY day ORDER BY day", (start,)).fetchall()
        traffic = db.execute("SELECT strftime('%Y-%m-%d',happened_at,'unixepoch') AS day, "
                             "COUNT(DISTINCT session_id) AS visitors, COUNT(*) AS views FROM events "
                             "WHERE happened_at>=? GROUP BY day ORDER BY day", (start,)).fetchall()
        return {"revenueCents": orders["revenue"] or 0, "orders": orders["n"] or 0,
                "pendingOrders": orders["pending"] or 0, "paidOrders": purchases,
                "products": len(product_list), "lowStock": low_stock,
                "customers": db.execute("SELECT COUNT(DISTINCT COALESCE(NULLIF(json_extract(customer_json,'$.email'),''),NULLIF(json_extract(customer_json,'$.phone'),''))) FROM orders").fetchone()[0],
                "visitors": visitors, "conversionPercent": conversion,
                "salesByDay": [dict(row) for row in sales], "trafficByDay": [dict(row) for row in traffic]}


def list_orders(limit=200):
    with connect() as db:
        rows = db.execute("SELECT * FROM orders ORDER BY created_at DESC LIMIT ?", (limit,)).fetchall()
    result = []
    for row in rows:
        item = dict(row)
        item["customer"] = json.loads(item.pop("customer_json"))
        item["items"] = json.loads(item.pop("items_json"))
        result.append(item)
    return result


def list_customers(limit=300):
    with connect() as db:
        rows = db.execute("SELECT MAX(json_extract(customer_json,'$.name')) AS name, "
                           "json_extract(customer_json,'$.email') AS email, "
                           "json_extract(customer_json,'$.phone') AS phone, COUNT(*) AS orders, "
                           "MAX(created_at) AS last_order FROM orders "
                           "WHERE COALESCE(NULLIF(email,''),NULLIF(phone,'')) IS NOT NULL "
                           "GROUP BY COALESCE(NULLIF(email,''),NULLIF(phone,'')) ORDER BY last_order DESC LIMIT ?", (limit,)).fetchall()
        return [dict(row) for row in rows]


def product_report():
    store = get_setting("store") or {}
    products = store.get("produtos", []) if isinstance(store, dict) else []
    sold = {}
    with connect() as db:
        rows = db.execute("SELECT items_json FROM orders WHERE payment_status='paid'").fetchall()
    for row in rows:
        try:
            items = json.loads(row["items_json"])
        except (TypeError, json.JSONDecodeError):
            continue
        for item in items if isinstance(items, list) else []:
            key = str(item.get("id", "")) if isinstance(item, dict) else ""
            if key:
                try:
                    quantity = max(0, int(item.get("quantity", 0) or 0))
                except (TypeError, ValueError):
                    quantity = 0
                sold[key] = sold.get(key, 0) + quantity
    result = []
    for item in products:
        if not isinstance(item, dict):
            continue
        try:
            stock = int(item.get("estoque", 0) or 0)
        except (TypeError, ValueError):
            stock = None
        try:
            amount = Decimal(str(item.get("preco", 0) or 0))
            price = int((amount * 100).quantize(Decimal("1"), rounding=ROUND_HALF_UP)) if amount.is_finite() else None
        except (TypeError, ValueError, InvalidOperation, OverflowError):
            price = None
        product_id = str(item.get("id", ""))
        result.append({"id": product_id, "name": str(item.get("nome", "")), "category": str(item.get("categoria", "")),
                       "stock": stock, "priceCents": price, "paidUnits": sold.get(product_id, 0)})
    return result


def analytics_summary(start, end, filters=None):
    filters = filters or {}
    where = ["happened_at BETWEEN ? AND ?"]
    params = [start, end]
    for key, column in (("page", "page_path"), ("product", "product_id"), ("source", "source"), ("device", "device")):
        value = str(filters.get(key, ""))[:180]
        if value:
            where.append(f"{column}=?")
            params.append(value)
    clause = " AND ".join(where)
    with connect() as db:
        events = db.execute("SELECT event_name,COUNT(*) AS count,COUNT(DISTINCT session_id) AS sessions "
                            f"FROM events WHERE {clause} GROUP BY event_name ORDER BY count DESC", params).fetchall()
        pages = db.execute("SELECT page_path,COUNT(*) AS views,COUNT(DISTINCT session_id) AS visitors "
                           f"FROM events WHERE event_name='page_view' AND {clause} "
                           "GROUP BY page_path ORDER BY views DESC LIMIT 30", params).fetchall()
        products = db.execute("SELECT product_id,COUNT(*) AS views,COUNT(DISTINCT session_id) AS visitors "
                              f"FROM events WHERE event_name='view_item' AND {clause} "
                              "GROUP BY product_id ORDER BY views DESC LIMIT 30", params).fetchall()
        sources = db.execute("SELECT source,COUNT(DISTINCT session_id) AS visitors FROM events "
                             f"WHERE {clause} GROUP BY source ORDER BY visitors DESC LIMIT 30", params).fetchall()
        devices = db.execute("SELECT device,browser,COUNT(DISTINCT session_id) AS visitors FROM events "
                             f"WHERE {clause} GROUP BY device,browser ORDER BY visitors DESC", params).fetchall()
        latest = db.execute("SELECT happened_at,event_name,session_id,page_path,product_id,source,device,browser "
                            f"FROM events WHERE {clause} ORDER BY happened_at DESC LIMIT 200", params).fetchall()
        counts = {row["event_name"]: row["count"] for row in events}
        return {"counts": counts, "events": [dict(row) for row in events], "pages": [dict(row) for row in pages],
                "products": [dict(row) for row in products], "sources": [dict(row) for row in sources],
                "devices": [dict(row) for row in devices], "latest": [dict(row) for row in latest],
                "ipCollection": False}
