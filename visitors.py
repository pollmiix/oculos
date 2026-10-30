"""Consented visitor activity for the local Python backend."""
import ipaddress
import json
import time

import database


def canonical_ip(value):
    try:
        return str(ipaddress.ip_address(value))
    except ValueError:
        return ""


def init_tables(db):
    db.executescript("""
        CREATE TABLE IF NOT EXISTS visitor_sessions (
          session_id TEXT PRIMARY KEY, first_seen INTEGER NOT NULL, last_seen INTEGER NOT NULL,
          ip_address TEXT NOT NULL, platform TEXT NOT NULL, browser TEXT NOT NULL,
          device TEXT NOT NULL, page_path TEXT NOT NULL, source TEXT NOT NULL,
          event_name TEXT NOT NULL, product_id TEXT NOT NULL, location TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS idx_visitors_seen ON visitor_sessions(last_seen);
        CREATE INDEX IF NOT EXISTS idx_visitors_ip ON visitor_sessions(ip_address);
        CREATE TABLE IF NOT EXISTS visitor_ip_blocks (ip_address TEXT PRIMARY KEY, created_at INTEGER NOT NULL);
    """)
    db.execute("DELETE FROM visitor_sessions WHERE last_seen < ?",
               (int(time.time()) - database.analytics_retention_days() * 86400,))


def is_blocked(ip):
    with database.connect() as db:
        return db.execute("SELECT 1 FROM visitor_ip_blocks WHERE ip_address=?", (canonical_ip(ip),)).fetchone() is not None


def agent_details(agent):
    agent = agent.lower()
    platform = next((label for pattern, label in [("android", "Android"), ("iphone", "iOS"), ("ipad", "iOS"),
                    ("windows", "Windows"), ("mac", "macOS"), ("linux", "Linux")] if pattern in agent), "Desconhecido")
    browser = next((label for pattern, label in [("edg", "Edge"), ("opr/", "Opera"), ("firefox", "Firefox"),
                   ("fxios", "Firefox"), ("chrome", "Chrome"), ("crios", "Chrome"), ("safari", "Safari")]
                    if pattern in agent), "Desconhecido")
    return platform, browser


def record(data, ip, agent):
    platform, browser = agent_details(agent)
    now = int(time.time())
    with database.connect() as db:
        db.execute("""INSERT INTO visitor_sessions
          (session_id,first_seen,last_seen,ip_address,platform,browser,device,page_path,source,event_name,product_id,location)
          VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(session_id) DO UPDATE SET
          last_seen=excluded.last_seen,ip_address=excluded.ip_address,platform=excluded.platform,
          browser=excluded.browser,device=excluded.device,page_path=excluded.page_path,source=excluded.source,
          event_name=CASE WHEN excluded.event_name='heartbeat' THEN visitor_sessions.event_name ELSE excluded.event_name END,
          product_id=CASE WHEN excluded.event_name='heartbeat' THEN visitor_sessions.product_id ELSE excluded.product_id END""",
          (data["sessionId"], now, now, canonical_ip(ip), platform, browser,
           str(data.get("device", "unknown"))[:30], data["page"], str(data.get("source", "direct"))[:180],
           data["name"], str(data.get("productId") or "")[:120], ""))
        db.execute("DELETE FROM visitor_sessions WHERE last_seen < ?", (now - database.analytics_retention_days() * 86400,))


def listing(page=1, filter_name=""):
    now = int(time.time())
    where = {"online": f"v.last_seen>={now - 90} AND b.ip_address IS NULL",
             "blocked": "b.ip_address IS NOT NULL"}.get(filter_name, "1=1")
    join = " FROM visitor_sessions v LEFT JOIN visitor_ip_blocks b ON b.ip_address=v.ip_address"
    with database.connect() as db:
        total = db.execute("SELECT COUNT(*)" + join + " WHERE " + where).fetchone()[0]
        pages = max(1, (total + 24) // 25)
        page = max(1, min(pages, page))
        rows = db.execute("SELECT v.*,b.ip_address AS blocked_ip,o.id AS order_id,o.payment_status,o.created_at AS order_created,o.total_cents,o.items_json"
                          + join + " LEFT JOIN orders o ON o.id=(SELECT id FROM orders WHERE analytics_session_id=v.session_id ORDER BY created_at DESC,id DESC LIMIT 1)"
                          + " WHERE " + where + " ORDER BY v.last_seen DESC,v.session_id LIMIT 25 OFFSET ?", ((page - 1) * 25,)).fetchall()
        store = database.get_setting("store") or {}
        products = {str(p["id"]): p.get("nome", "") for p in store.get("produtos", [])}
        visits = []
        for item in rows:
            row = dict(item)
            row["blocked"] = row.pop("blocked_ip") is not None
            row["online"] = not row["blocked"] and row["last_seen"] >= now - 90
            row["product_name"] = products.get(row["product_id"], row["product_id"])
            items = json.loads(row.pop("items_json") or "[]")
            if not row["product_name"] and row["order_id"]:
                row["product_name"] = " · ".join(item.get("name", "") for item in items if isinstance(item, dict))
            visits.append(row)
        summary = {"visits": db.execute("SELECT COUNT(*) FROM visitor_sessions").fetchone()[0],
                   "online": db.execute("SELECT COUNT(*)" + join + " WHERE v.last_seen>=? AND b.ip_address IS NULL", (now - 90,)).fetchone()[0],
                   "blocked": db.execute("SELECT COUNT(*) FROM visitor_ip_blocks").fetchone()[0]}
    return dict(visits=visits, page=page, pages=pages, total=total, summary=summary, serverTime=now)


def action(data):
    name = data.get("action")
    with database.connect() as db:
        if name == "unblock_all":
            db.execute("DELETE FROM visitor_ip_blocks")
            return
        if name not in {"block", "unblock", "delete"}:
            raise ValueError("Ação de visita inválida.")
        session_id = data.get("sessionId")
        row = db.execute("SELECT ip_address FROM visitor_sessions WHERE session_id=?", (session_id,)).fetchone()
        if row is None:
            raise ValueError("Visita não encontrada. Atualize a lista.")
        if name == "delete":
            db.execute("DELETE FROM events WHERE session_id=?", (session_id,))
            db.execute("DELETE FROM visitor_sessions WHERE session_id=?", (session_id,))
        elif name == "block":
            ip = canonical_ip(row["ip_address"])
            if not ip:
                raise ValueError("Esta visita não possui um IP válido.")
            db.execute("INSERT INTO visitor_ip_blocks VALUES(?,?) ON CONFLICT(ip_address) DO UPDATE SET created_at=excluded.created_at", (ip, int(time.time())))
        else:
            db.execute("DELETE FROM visitor_ip_blocks WHERE ip_address=?", (row["ip_address"],))
