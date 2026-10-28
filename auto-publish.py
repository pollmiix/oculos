"""Publish saved store changes to GitHub after a quiet interval."""
from pathlib import Path
import hashlib
import json
import os
import subprocess
import time

ROOT = Path(__file__).resolve().parent
STATE = ROOT / '.auto-publish'
QUIET_SECONDS = 15
EXCLUDED_DIRS = {'.vscode', '.agents', '.codex', '.aws', '.auto-publish', 'certs'}


def git(*args):
    env = dict(os.environ, GIT_TERMINAL_PROMPT='0', GCM_INTERACTIVE='never',
               GIT_AUTHOR_NAME='Publicador da loja', GIT_COMMITTER_NAME='Publicador da loja',
               GIT_AUTHOR_EMAIL='auto-publish@localhost', GIT_COMMITTER_EMAIL='auto-publish@localhost')
    result = subprocess.run(['git', *args], cwd=ROOT, env=env,
                            capture_output=True, timeout=90,
                            creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)
    if result.returncode:
        raise RuntimeError(result.stderr.decode('utf-8', errors='replace').strip()
                           or 'Git failed: ' + args[0])
    return result.stdout


def eligible(name):
    path = Path(name)
    lower = name.lower()
    return (not any(part.lower() in EXCLUDED_DIRS for part in path.parts)
            and not path.name.lower().startswith('.env')
            and path.name.lower() != 'config.local.php'
            and path.suffix.lower() not in {'.key', '.pem', '.pfx', '.p12', '.db', '.sqlite', '.sqlite3', '.log'}
            and not any(word in lower for word in ('credentials', 'private-key', 'private_key')))


def pending():
    names = git('ls-files', '--modified', '--deleted', '--others', '--exclude-standard', '-z')
    return sorted({name for name in names.decode('utf-8').split('\0') if name and eligible(name)})


def fingerprint(paths):
    digest = hashlib.sha256()
    for name in paths:
        digest.update(name.encode('utf-8'))
        path = ROOT / name
        digest.update(path.read_bytes() if path.is_file() else b'<deleted>')
    return digest.hexdigest()


def status(message):
    stamp = time.strftime('%Y-%m-%d %H:%M:%S')
    STATE.mkdir(exist_ok=True)
    (STATE / 'status.json').write_text(json.dumps({'time': stamp, 'message': message}, ensure_ascii=False), encoding='utf-8')
    with (STATE / 'publish.log').open('a', encoding='utf-8') as log:
        log.write(stamp + ' ' + message + '\n')


def synchronize():
    if git('branch', '--show-current').decode().strip() != 'main':
        raise RuntimeError('Publicacao automatica aguarda a branch main.')
    if (ROOT / '.git' / 'MERGE_HEAD').exists():
        raise RuntimeError('Resolva o merge pendente antes de publicar.')
    git('fetch', 'origin', 'main')
    behind = int(git('rev-list', '--count', 'HEAD..origin/main').decode())
    if behind:
        git('merge', '--no-edit', 'origin/main')
    ahead = int(git('rev-list', '--count', 'origin/main..HEAD').decode())
    if ahead:
        git('push', 'origin', 'main')
        status('Publicado no GitHub: ' + git('rev-parse', '--short', 'HEAD').decode().strip()
               + '. Acompanhe o deploy na Vercel.')


def main():
    STATE.mkdir(exist_ok=True)
    (STATE / 'pid').write_text(str(os.getpid()), encoding='ascii')
    status('Publicacao automatica iniciada. Aguarda 15 segundos sem alteracoes.')
    previous = None
    changed_at = time.monotonic()
    last_sync = 0
    while True:
        try:
            paths = pending()
            current = fingerprint(paths)
            if current != previous:
                previous, changed_at = current, time.monotonic()
            elif paths and time.monotonic() - changed_at >= QUIET_SECONDS:
                if git('diff', '--cached', '--name-only').strip():
                    raise RuntimeError('Ha arquivos preparados manualmente no Git; aguardando para nao interferir.')
                git('add', '--', *paths)
                if git('diff', '--cached', '--name-only').strip():
                    git('commit', '-m', 'Atualizar loja automaticamente', '--only', '--', *paths)
                synchronize()
                previous = None
                last_sync = time.monotonic()
            elif not paths and time.monotonic() - last_sync >= 60:
                synchronize()
                last_sync = time.monotonic()
        except Exception as error:
            status('Publicacao pendente: ' + str(error))
            time.sleep(30)
        time.sleep(2)


if __name__ == '__main__':
    main()
