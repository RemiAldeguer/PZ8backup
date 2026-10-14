#!/usr/bin/env python3
"""Build a private PZ7 runtime DB from a verified migration bundle and PZ8 auth.

This never updates the active SQLite file or the migration bundle. A source workspace
changed since its snapshot is refused rather than silently losing subsequent edits.
"""
import argparse
import hashlib
import json
import os
import sqlite3
import sys
import tempfile
from pathlib import Path

TABLES = ('zones', 'projects', 'tasks', 'resources', 'profiles', 'timeEntries', 'comments',
          'expenses', 'revenues', 'calendarEvents', 'unavailabilities', 'projectTemplates',
          'customFieldDefinitions', 'reportTemplates', 'projectStatusDefinitions',
          'strategicAxes', 'projectReports', 'projectDocuments', 'documentFolders',
          'taskLists', 'permissionPolicies', 'organizationUnits')
AUTH_TABLES = ('auth_users', 'auth_sessions', 'auth_attempts')


def run(source_path, bundle, output):
    if output.exists():
        raise ValueError(f'Refusing to overwrite {output}')
    source = sqlite3.connect(f'file:{source_path.resolve()}?mode=ro', uri=True)
    migrated = sqlite3.connect(f'file:{(bundle / "workspace.sqlite").resolve()}?mode=ro', uri=True)
    target = None
    staging = None
    try:
        source.execute('BEGIN')  # hold one consistent snapshot, including WAL
        snapshot_bytes = (bundle / 'source-json.json').read_bytes()
        original = json.loads(snapshot_bytes)
        report = json.loads((bundle / 'report.json').read_text(encoding='utf-8'))
        if report.get('snapshot_sha256') != hashlib.sha256(snapshot_bytes).hexdigest() or \
           report.get('workspace_sha256') != hashlib.sha256((bundle / 'workspace.sqlite').read_bytes()).hexdigest():
            raise ValueError('Migration bundle files do not match report hashes')
        for table in TABLES:
            current = [(row_id, json.loads(raw)) for row_id, raw in source.execute(f'SELECT id,data FROM "{table}" ORDER BY rowid')]
            if current != [(record['id'], record) for record in original.get(table, [])]:
                raise ValueError(f'Workspace changed after migration snapshot: {table}; rerun the import first')
        # The exporter currently maps the nine core collections. Do not publish dangling
        # native identities for historical extra records until their import is implemented.
        for table in ('projectStatusDefinitions', 'strategicAxes', 'organizationUnits',
                      'projectReports', 'calendarEvents', 'unavailabilities'):
            if original[table]:
                raise ValueError(f'Existing {table} needs a native PZ7 import; refusing an incomplete runtime')
        for table in AUTH_TABLES:
            if not source.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (table,)).fetchone():
                raise ValueError(f'Cannot preserve authentication: missing {table}')
        fd, name = tempfile.mkstemp(prefix='.pz7-runtime-', dir=output.parent)
        os.close(fd)
        staging = Path(name)
        target = sqlite3.connect(staging)
        migrated.backup(target)
        target.execute('PRAGMA foreign_keys=ON')
        target.execute('BEGIN IMMEDIATE')
        target.execute('''CREATE TABLE pz8_identity (
          entity TEXT NOT NULL, id TEXT NOT NULL, uuid TEXT NOT NULL,
          data TEXT NOT NULL CHECK(json_valid(data)), position INTEGER NOT NULL,
          PRIMARY KEY(entity,id), UNIQUE(entity,uuid))''')
        target.execute('CREATE INDEX pz8_identity_position ON pz8_identity(entity,position)')
        target.execute('''CREATE TABLE pz8_membership_ownership (
          member_uuid TEXT PRIMARY KEY REFERENCES pz_project_member(uuid) ON DELETE CASCADE)''')
        target.execute('INSERT INTO pz8_membership_ownership(member_uuid) SELECT uuid FROM pz_project_member')
        target.execute('''CREATE TABLE pz8_unit_memberships (
          unit_uuid TEXT NOT NULL REFERENCES pz_organizational_unit(uuid) ON DELETE CASCADE,
          resource_uuid TEXT NOT NULL REFERENCES pz_resource(uuid) ON DELETE RESTRICT,
          position INTEGER NOT NULL,
          PRIMARY KEY(unit_uuid,resource_uuid))''')
        mapping = report['source_to_target_ids']
        native_tables = {'zones': 'pz_zone', 'projects': 'pz_project', 'resources': 'pz_resource',
                         'profiles': 'pz_cost_profile', 'timeEntries': 'pz_time_record',
                         'comments': 'pz_comment', 'expenses': 'pz_expense', 'taskLists': 'pz_activity'}
        for table, native in native_tables.items():
            if set(mapping.get(table, {})) != {record['id'] for record in original[table]}:
                raise ValueError(f'Incomplete or foreign ID mapping: {table}')
            for identifier in mapping[table].values():
                if not target.execute(f'SELECT 1 FROM {native} WHERE uuid=?', (identifier,)).fetchone():
                    raise ValueError(f'ID mapping points to missing PZ7 {native} row: {identifier}')
        if set(mapping.get('tasks', {})) != {record['id'] for record in original['tasks']}:
            raise ValueError('Incomplete or foreign task ID mapping')
        for record in original['tasks']:
            native = 'pz_milestone' if record.get('kind') == 'milestone' else 'pz_task'
            identifier = mapping['tasks'][record['id']]
            if not target.execute(f'SELECT 1 FROM {native} WHERE uuid=?', (identifier,)).fetchone():
                raise ValueError(f'ID mapping points to missing {native} row: {identifier}')
        for table in TABLES:
            for position, record in enumerate(original[table]):
                mapped = mapping.get(table, {}).get(record['id'])
                # Non-PZ7 entities keep their own UUID and JSON until a native mapping exists.
                identifier = mapped or record['id']
                target.execute('INSERT INTO pz8_identity(entity,id,uuid,data,position) VALUES (?,?,?,?,?)',
                               (table, record['id'], identifier, json.dumps(record, ensure_ascii=False, separators=(',', ':')), position))
        # Auth resource IDs are textual legacy IDs; SQLite does not enforce this relation.
        for (resource_id,) in source.execute('SELECT resource_id FROM auth_users'):
            if not target.execute("SELECT 1 FROM pz8_identity WHERE entity='resources' AND id=?", (resource_id,)).fetchone():
                raise ValueError(f'Account points to missing resource: {resource_id}')
        # Auth schemas and password/session rows must remain byte-for-byte the same.
        for table in AUTH_TABLES:
            ddl = source.execute("SELECT sql FROM sqlite_master WHERE type='table' AND name=?", (table,)).fetchone()[0]
            target.execute(ddl)
            columns = [row[1] for row in source.execute(f'PRAGMA table_info("{table}")')]
            placeholders = ','.join('?' for _ in columns)
            for row in source.execute(f'SELECT * FROM "{table}"'):
                target.execute(f'INSERT INTO "{table}" VALUES ({placeholders})', row)
        for (name, ddl) in source.execute("SELECT name,sql FROM sqlite_master WHERE type='index' AND tbl_name IN ('auth_users','auth_sessions','auth_attempts') AND sql IS NOT NULL"):
            target.execute(ddl)
        bad = target.execute('PRAGMA foreign_key_check').fetchall()
        if bad:
            raise ValueError(f'Foreign keys invalid: {bad[:3]}')
        target.commit()
        if target.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
            raise ValueError('SQLite integrity check failed')
        target.close()
        target = None
        # Hard-link publication is atomic and fails if another run already created the destination.
        os.link(staging, output)
    except Exception:
        if target is not None:
            target.rollback()
            target.close()
            target = None
        raise
    finally:
        if staging is not None:
            staging.unlink(missing_ok=True)
        source.close()
        migrated.close()
        if target is not None:
            target.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, default=Path('data/planzone.sqlite'))
    parser.add_argument('--bundle', type=Path, default=Path('data/pz7-migrated'))
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    run(args.source, args.bundle, args.output.absolute())
    print(f'Prepared PZ7 runtime database: {args.output.absolute()}')


if __name__ == '__main__':
    try:
        main()
    except (ValueError, sqlite3.Error, OSError, KeyError) as error:
        print(f'Preparation failed: {error}', file=sys.stderr)
        sys.exit(1)
