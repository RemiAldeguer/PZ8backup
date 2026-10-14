#!/usr/bin/env python3
"""Export a private, prepared PZ7 runtime SQLite database for MANUAL browser import.

Usage: python3 scripts/export-pz7-browser.py --source data/pz7-runtime-active.sqlite \
    --output /private/path/pz7-browser.sqlite

The source is opened read-only and backed up as a coherent SQLite snapshot (including
committed WAL transactions). The destination must not exist; it must be outside any
public/ or dist/ tree. The resulting file contains workspace data, so keep it private
(mode 0600), transfer it only by a trusted manual import, and never commit or serve it.
Authentication tables, their indexes/triggers, and SQLite free pages are removed.
"""
import argparse
import os
from pathlib import Path
import re
import sqlite3
import sys
import tempfile

REQUIRED = ('pz8_identity', 'pz_zone', 'pz_project', 'pz_activity', 'pz_task',
            'pz_milestone', 'pz_resource', 'pz_cost_profile', 'pz_time_record',
            'pz_comment', 'pz_expense')
AUTH = ('auth_users', 'auth_sessions', 'auth_attempts')
AUTH_REFERENCE = re.compile(r'\bauth_[a-zA-Z0-9_]+\b', re.IGNORECASE)


def quoted(name):
    return '"' + name.replace('"', '""') + '"'


def check_destination(source_path, output):
    if any(part.lower() in ('public', 'dist') for part in output.parts) or any(
            part.lower() in ('public', 'dist') for part in output.resolve().parts):
        raise ValueError('Destination inside public/ or dist/ is forbidden')
    if output.exists() or output.is_symlink():
        raise ValueError(f'Refusing to overwrite {output}')
    if output.resolve() == source_path.resolve():
        raise ValueError('Source and destination must differ')


def validate_prepared(db):
    names = {name for (name,) in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    if not set(REQUIRED).issubset(names) or 'projects' in names or 'tasks' in names:
        raise ValueError('Source is not a prepared PZ7 runtime database')
    columns = {row[1] for row in db.execute('PRAGMA table_info(pz8_identity)')}
    if not {'entity', 'id', 'uuid', 'data', 'position'}.issubset(columns):
        raise ValueError('Source has an invalid pz8_identity schema')
    if 'recording_day' in {row[1] for row in db.execute('PRAGMA table_info(pz_time_record)')}:
        raise ValueError('Source has deprecated recording_day; not a prepared PZ7 runtime')
    if not set(AUTH).issubset(names):
        raise ValueError('Source is missing expected authentication tables')
    if db.execute('PRAGMA integrity_check').fetchone() != ('ok',):
        raise ValueError('Source failed SQLite integrity_check')
    if db.execute('PRAGMA foreign_key_check').fetchone():
        raise ValueError('Source failed SQLite foreign_key_check')


def strip_auth(db):
    objects = db.execute("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE type IN ('table','index','trigger','view')").fetchall()
    auth_tables = {name for kind, name, _, _ in objects if kind == 'table' and name.lower().startswith('auth_')}
    # Refuse unknown non-auth schema dependencies rather than publishing a broken
    # database or retaining objects capable of exposing credentials.
    for kind, name, table, sql in objects:
        if name.lower().startswith('auth_') or table.lower() in auth_tables:
            continue
        if sql and AUTH_REFERENCE.search(sql):
            raise ValueError(f'Non-auth schema object references authentication: {name}')
    db.execute('PRAGMA foreign_keys=OFF')
    db.execute('BEGIN IMMEDIATE')
    try:
        for kind, name, table, _ in objects:
            if kind in ('view', 'trigger', 'index') and (name.lower().startswith('auth_') or table.lower() in auth_tables):
                # Implicit indexes are dropped with their owning table.
                if kind != 'index' or not name.startswith('sqlite_autoindex_'):
                    db.execute(f'DROP {kind.upper()} IF EXISTS {quoted(name)}')
        for name in sorted(auth_tables):
            db.execute(f'DROP TABLE {quoted(name)}')
        db.commit()
    except Exception:
        db.rollback()
        raise
    # DROP leaves deleted passwords/tokens in free pages. VACUUM must run outside
    # the transaction to reconstruct the file without those pages.
    db.execute('VACUUM')
    remaining = db.execute("SELECT name,sql FROM sqlite_master WHERE type IN ('table','index','trigger','view')").fetchall()
    if any(name.lower().startswith('auth_') or (sql and AUTH_REFERENCE.search(sql)) for name, sql in remaining):
        raise ValueError('Authentication schema remains in browser export')
    if db.execute('PRAGMA integrity_check').fetchone() != ('ok',):
        raise ValueError('Browser export failed SQLite integrity_check')
    if db.execute('PRAGMA foreign_key_check').fetchone():
        raise ValueError('Browser export failed SQLite foreign_key_check')


def run(source_path, output):
    source_path = source_path.absolute()
    output = output.absolute()
    check_destination(source_path, output)
    # SQLite read-only URI allows WAL snapshots without modifying the source DB.
    source = sqlite3.connect(source_path.resolve().as_uri() + '?mode=ro', uri=True)
    stage = None
    target = None
    try:
        source.execute('BEGIN')
        validate_prepared(source)
        check_destination(source_path, output)
        fd, name = tempfile.mkstemp(prefix='.pz7-browser-', suffix='.sqlite', dir=output.parent)
        stage = Path(name)
        os.close(fd)
        target = sqlite3.connect(stage)
        source.backup(target)
        # A standalone manual-import file must not depend on WAL/shm sidecars.
        if target.execute('PRAGMA journal_mode=DELETE').fetchone()[0].lower() != 'delete':
            raise ValueError('Could not disable WAL on browser export')
        strip_auth(target)
        target.close()
        target = None
        os.chmod(stage, 0o600)
        with stage.open('rb') as data:
            os.fsync(data.fileno())
        # Hard-link is atomic and fails if another process created output first.
        os.link(stage, output)
    finally:
        if target is not None:
            target.close()
        source.close()
        if stage is not None:
            stage.unlink(missing_ok=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, required=True, help='active prepared PZ7 runtime SQLite file')
    parser.add_argument('--output', type=Path, required=True, help='new private browser-import SQLite file')
    args = parser.parse_args()
    run(args.source, args.output)
    print(f'Private browser export ready for manual import: {args.output.absolute()}')


if __name__ == '__main__':
    try:
        main()
    except (ValueError, sqlite3.Error, OSError) as error:
        print(f'Browser export failed: {error}', file=sys.stderr)
        sys.exit(1)
