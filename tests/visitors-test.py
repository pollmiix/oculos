import json
import sys
import tempfile
import threading
import time
import unittest
import uuid
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import database
import visitors
from server import StoreHandler, ThreadingHTTPServer


class VisitorTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.original_dir, self.original_path = database.DATA_DIR, database.DB_PATH
        database.DATA_DIR = Path(self.temp.name)
        database.DB_PATH = database.DATA_DIR / 'test.sqlite3'
        database.init_db({'produtos': [{'id': 'glasses', 'nome': 'Óculos de teste'}]})
        self.session = str(uuid.uuid4())

    def tearDown(self):
        database.DATA_DIR, database.DB_PATH = self.original_dir, self.original_path
        self.temp.cleanup()

    def record(self, name='view_item', session=None, ip='192.0.2.4'):
        visitors.record(dict(name=name, sessionId=session or self.session, page='/produto.html',
                             productId='glasses', device='desktop', source='https://example.org'),
                        ip, 'Mozilla/5.0 (Windows NT 10.0) Chrome/130.0')

    def test_activity_pagination_and_blocks(self):
        self.record()
        self.record('heartbeat')
        row = visitors.listing()['visits'][0]
        self.assertEqual(row['event_name'], 'view_item')
        self.assertEqual(row['product_name'], 'Óculos de teste')
        self.assertEqual(row['platform'], 'Windows')
        self.assertEqual(row['browser'], 'Chrome')
        self.assertTrue(row['online'])
        with database.connect() as db:
            db.execute('UPDATE visitor_sessions SET last_seen=?', (int(time.time()) - 11,))
        self.assertFalse(visitors.listing()['visits'][0]['online'])
        for _ in range(27):
            self.record(session=str(uuid.uuid4()))
        self.assertEqual(visitors.listing()['pages'], 2)
        self.assertEqual(len(visitors.listing(1)['visits']), 25)
        self.assertEqual(len(visitors.listing(2)['visits']), 3)
        visitors.action({'action': 'block', 'sessionId': self.session})
        self.assertTrue(visitors.is_blocked('192.0.2.4'))
        self.assertEqual(visitors.listing(filter_name='blocked')['total'], 28)
        self.assertEqual(visitors.listing(filter_name='online')['total'], 0)
        visitors.action({'action': 'unblock', 'sessionId': self.session})
        self.assertFalse(visitors.is_blocked('192.0.2.4'))
        visitors.action({'action': 'block', 'sessionId': self.session})
        visitors.action({'action': 'unblock_all'})
        self.assertEqual(visitors.listing()['summary']['blocked'], 0)

    def test_delete_preserves_orders_and_blocks(self):
        self.record()
        database.record_event('view_item', self.session, '/produto.html')
        database.create_order('order-1', 'trx-1', 'paid', 'paid', 'blackcat', 15900, {}, [], self.session)
        visitors.action({'action': 'block', 'sessionId': self.session})
        visitors.action({'action': 'delete', 'sessionId': self.session})
        self.assertEqual(visitors.listing()['total'], 0)
        self.assertTrue(visitors.is_blocked('192.0.2.4'))
        with database.connect() as db:
            self.assertEqual(db.execute('SELECT COUNT(*) FROM events').fetchone()[0], 0)
            self.assertEqual(db.execute('SELECT payment_status FROM orders').fetchone()[0], 'paid')

    def test_http_authorization_csrf_heartbeat_and_access_block(self):
        database.create_analyst('owner-test', 'test-pass-123456')
        database.create_analyst('analyst-test', 'test-pass-123456')
        with database.connect() as db:
            db.execute("UPDATE admins SET role='owner' WHERE username='owner-test'")
        owner = database.authenticate('owner-test', 'test-pass-123456')
        analyst = database.authenticate('analyst-test', 'test-pass-123456')
        class QuietHandler(StoreHandler):
            def log_message(self, *args):
                pass
        httpd = ThreadingHTTPServer(('127.0.0.1', 0), QuietHandler)
        thread = threading.Thread(target=httpd.serve_forever, daemon=True)
        thread.start()
        def request(path, data=None, session=None, csrf=True):
            headers = {'Content-Type': 'application/json'}
            if session:
                headers['Cookie'] = 'mn_admin=' + session['token']
                if csrf:
                    headers['X-CSRF-Token'] = session['csrfToken']
            req = Request(f'http://127.0.0.1:{httpd.server_port}{path}', headers=headers,
                          data=json.dumps(data).encode() if data is not None else None)
            try:
                with urlopen(req) as response:
                    return response.status, json.load(response)
            except HTTPError as error:
                return error.code, json.load(error)
        try:
            self.assertEqual(request('/api/admin/visitors')[0], 401)
            self.assertEqual(request('/api/admin/visitors', session=analyst)[0], 403)
            payload = {'name': 'page_view', 'sessionId': self.session, 'page': '/'}
            self.assertEqual(request('/api/events', payload)[0], 202)
            payload['name'] = 'heartbeat'
            self.assertEqual(request('/api/events', payload)[0], 202)
            with database.connect() as db:
                self.assertEqual(db.execute('SELECT COUNT(*) FROM events').fetchone()[0], 1)
            block = {'action': 'block', 'sessionId': self.session}
            self.assertEqual(request('/api/admin/visitors', block, owner, csrf=False)[0], 403)
            self.assertEqual(request('/api/admin/visitors', block, analyst)[0], 403)
            self.assertEqual(request('/api/admin/visitors', block, owner)[0], 200)
            self.assertEqual(request('/api/store')[0], 403)
            self.assertEqual(request('/api/orders/manual', {})[0], 403)
            self.assertEqual(request('/api/admin/visitors', session=owner)[0], 200)
            self.assertEqual(request('/api/admin/visitors', {'action': 'unblock_all'}, owner)[0], 200)
            self.assertEqual(request('/api/store')[0], 200)
        finally:
            httpd.shutdown()
            httpd.server_close()
            thread.join()


if __name__ == '__main__':
    unittest.main()
