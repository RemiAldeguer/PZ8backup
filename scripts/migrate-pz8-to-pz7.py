#!/usr/bin/env python3
"""Import a PZ8 workspace into a NEW copy of the empty PZ7 SQLite schema.

Never changes either input. Source JSON records are saved separately so fields that
have no PZ7 equivalent remain recoverable. Authentication credentials are excluded.
"""
import argparse
import ctypes
import errno
import hashlib
import json
import os
import shutil
import sqlite3
import sys
import tempfile
import uuid
from collections import Counter
from pathlib import Path

NAMESPACE = uuid.UUID('7da2c87c-4dc7-40b1-b0fb-fba73d75e5c6')
TASK_STATUSES = {
    'todo': ('edef46b9-1624-41fc-a81a-836a5317f2a6', 'pr_todo', '#b3b3b3', 0),
    'in_progress': ('96a35cfc-6c73-41cc-818b-900802a2757b', 'pr_in_progress', '#269FFF', 20),
    'done': ('7a69411f-9120-40b0-badd-f7315c68272e', 'pr_done', '#8DCC88', 100),
}
PROJECT_STATUSES = {
    'requested': ('a46cf35d-c3df-49e3-b4e5-684e60ba7846', 'pz_candidate', '#E6DF22'),
    'open': ('d17077ce-884a-410d-92c8-d4d8099f06f4', 'pz_open', '#2CC166'),
    'closed': ('55995be6-c6c4-4aa7-93e4-cde1263884ab', 'pz_closed', '#B9B9B9'),
    'waiting': ('961ea322-5ec3-4a06-860c-67fa39ba75db', 'pz_waiting', '#FF7441'),
}
ROLES = {
    'pz_admin': '13626807-2fd2-481c-a074-1f16ca51b62c',
    'pz_user': '46257e2e-754e-4743-86f5-ae542d00506e',
    'pz_visitor': '8d860e15-4017-4c8d-97e3-26ce6ae81379',
    'pr_visitor': '8f670ae4-2102-4ee7-a724-7b2ecb985275',
    'pz_under_admin': '9148d12c-407e-4604-b1c6-eadceb943d48',
    'pr_manager': 'a448a59f-5c90-4c13-be70-926157b61643',
    'pr_worker': 'c583582e-9601-4619-8a58-b1a4ba8acbab',
}
GLOBAL_ROLES = {'administrator': 'pz_admin', 'project_creator': 'pz_under_admin',
                'user': 'pz_user', 'visitor': 'pz_visitor'}
PROJECT_ROLES = {'manager': 'pr_manager', 'collaborator': 'pr_worker', 'observer': 'pr_visitor'}
RESOURCE_TYPES = {'virtual': 0, 'human': 1, 'material': 2}
TABLES = ('zones', 'projects', 'tasks', 'resources', 'profiles', 'timeEntries', 'comments',
          'expenses', 'revenues', 'calendarEvents', 'unavailabilities', 'projectTemplates',
          'customFieldDefinitions', 'reportTemplates', 'projectStatusDefinitions',
          'strategicAxes', 'projectReports', 'projectDocuments', 'documentFolders',
          'taskLists', 'permissionPolicies', 'organizationUnits')


def uid(kind, identifier):
    return str(uuid.uuid5(NAMESPACE, f'{kind}:{identifier}'))


def read_source(db):
    db.execute('BEGIN')  # one consistent WAL snapshot
    return {table: [json.loads(row[0]) for row in db.execute(f'SELECT data FROM "{table}" ORDER BY rowid')]
            for table in TABLES}


def put(db, table, **values):
    columns = ', '.join('"' + key + '"' for key in values)
    marks = ', '.join('?' for _ in values)
    db.execute(f'INSERT INTO "{table}" ({columns}) VALUES ({marks})', tuple(values.values()))


def index(records):
    result = {}
    for record in records:
        key = record['id']
        if key in result:
            raise ValueError(f'Duplicate source id: {key}')
        result[key] = record
    return result


def migrate(db, data):
    report = {'imported': {}, 'warnings': [], 'not_imported': {},
              'date_conflicts': [], 'id_mapping': 'UUIDv5(namespace fixed in script, entity type + source id)'}
    counts = Counter()
    def add(table, **values):
        put(db, table, **values)
        counts[table] += 1
    projects = index(data['projects']); tasks = index(data['tasks'])
    resources = index(data['resources']); zones = index(data['zones'])
    profiles = index(data['profiles']); lists = index(data['taskLists'])
    for (table,) in db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"):
        quoted_table = '"' + table.replace('"', '""') + '"'
        if db.execute(f'SELECT count(*) FROM {quoted_table}').fetchone()[0]:
            raise ValueError(f'Target schema must be completely empty; found rows in {table}')
    if 'recording_day' in [row[1] for row in db.execute('PRAGMA table_info(pz_time_record)')]:
        raise ValueError('Target must omit the deprecated pz_time_record.recording_day column')

    planzone_id = uid('planzone', 'pz8-workspace')
    add('pz_planzone', uuid=planzone_id, name='Planzone 8 import', active=1, expired=0)
    for role, identifier in ROLES.items():
        add('pz_role', uuid=identifier, name=role)
    for identifier, label, color in PROJECT_STATUSES.values():
        add('pz_project_status', uuid=identifier, label=label, color=color, planzone_uuid=planzone_id)
    add('pz_project_status', uuid=uid('project-status', 'paused'), label='pz_paused',
        color='#F59E0B', planzone_uuid=planzone_id)
    for identifier, label, color, percent in TASK_STATUSES.values():
        add('pz_status', uuid=identifier, label=label, color=color, percent_complete=percent)
    for zone in data['zones']:
        add('pz_zone', uuid=uid('zone', zone['id']), planzone_uuid=planzone_id,
            name=zone['name'], color=zone.get('color'), saving_templates=0)
    for profile in data['profiles']:
        add('pz_cost_profile', uuid=uid('profile', profile['id']), planzone_uuid=planzone_id,
            name=profile['name'])
        # Original daily rate and EqJT unit are retained verbatim in the sidecar.
        add('pz_cost_profile_history', uuid=uid('profile-history', profile['id']),
            cost_profile_uuid=uid('profile', profile['id']), cost=profile['dailyRate'])
    for resource in data['resources']:
        profile_id = resource.get('profileId')
        if profile_id is not None and profile_id not in profiles:
            raise ValueError(f'Unknown profile of resource {resource["id"]}')
        kind = resource['type']
        if kind not in RESOURCE_TYPES:
            raise ValueError(f'Unknown resource type: {kind}')
        calendar_id = uid('calendar', resource['id'])
        daily = resource.get('dailyHours', 0)
        weekly = resource.get('weeklyCapacityHours') or [resource.get('mondayHours', daily), daily, daily, daily, daily, 0, 0]
        if len(weekly) != 7:
            raise ValueError(f'Invalid weekly capacity of resource {resource["id"]}')
        add('pz_weekly_calendar', uuid=calendar_id, monday_hours=weekly[0], tuesday_hours=weekly[1],
            wednesday_hours=weekly[2], thursday_hours=weekly[3], friday_hours=weekly[4],
            saturday_hours=weekly[5], sunday_hours=weekly[6])
        # Match normalizeResource() for legacy records with no stored role.
        role = resource.get('role') or ('administrator' if resource['id'] == 'resource-claire' else 'user')
        if role not in GLOBAL_ROLES:
            raise ValueError(f'Unknown global role of resource {resource["id"]}: {role}')
        add('pz_resource', uuid=uid('resource', resource['id']), planzone_uuid=planzone_id,
            name=resource['name'], profession=resource.get('jobTitle'), description=resource.get('description'),
            type=RESOURCE_TYPES[kind], affiliation=None, invitation_accepted=0,
            deactivated=int(not resource.get('active', True)), weekly_calendar_uuid=calendar_id,
            cost_profile_uuid=uid('profile', profile_id) if profile_id else None,
            role_uuid=ROLES[GLOBAL_ROLES[role]])
    for resource in data['resources']:
        manager = resource.get('managerId')
        if manager:
            if manager not in resources:
                raise ValueError(f'Unknown manager: {manager}')
            db.execute('UPDATE pz_resource SET manager_uuid=? WHERE uuid=?',
                       (uid('resource', manager), uid('resource', resource['id'])))
    for project in data['projects']:
        if project['zoneId'] not in zones:
            raise ValueError(f'Unknown zone of project {project["id"]}')
        status = project['status']
        if status not in PROJECT_STATUSES and status != 'paused':
            raise ValueError(f'Unknown project status: {status}')
        status_id = uid('project-status', 'paused') if status == 'paused' else PROJECT_STATUSES[status][0]
        add('pz_project', uuid=uid('project', project['id']), zone_uuid=uid('zone', project['zoneId']),
            name=project['name'], description=project.get('description'), color=project.get('color'),
            status_uuid=status_id, template=0, allocated_budget=project.get('budget', 0),
            allocated_expenses_budget=0, allocated_resources_budget=0)
        root = uid('activity-root', project['id'])
        add('pz_activity', uuid=root, project_uuid=uid('project', project['id']), name=project['name'],
            start_date=project.get('startDate'), end_date=project.get('endDate'))
        db.execute('UPDATE pz_project SET activity_root_uuid=? WHERE uuid=?',
                   (root, uid('project', project['id'])))
        for status_name in ('ready', 'validation'):
            add('pz_status', uuid=uid('task-status', f'{project["id"]}:{status_name}'),
                project_uuid=uid('project', project['id']), label=f'pr_{status_name}',
                color='#6B7280', percent_complete=None)
    # Materialize explicit lists (parents first) and historical virtual phase groups.
    pending = dict(lists)
    while pending:
        progress = False
        for list_id, item in list(pending.items()):
            parent = item.get('parentId')
            if parent and parent in pending:
                continue
            if item['projectId'] not in projects or (parent and (parent not in lists or lists[parent]['projectId'] != item['projectId'])):
                raise ValueError(f'Invalid task list parent/project: {list_id}')
            add('pz_activity', uuid=uid('list', list_id), project_uuid=uid('project', item['projectId']),
                activity_parent_uuid=uid('list', parent) if parent else uid('activity-root', item['projectId']),
                name=item['name'], activity_key_rank=item.get('position'))
            del pending[list_id]
            progress = True
        if not progress:
            raise ValueError('Task list parent cycle')
    phases = {}
    for task in data['tasks']:
        project_id = task['projectId']
        if project_id not in projects:
            raise ValueError(f'Unknown task project: {project_id}')
        if task.get('listId'):
            list_id = task['listId']
            if list_id not in lists or lists[list_id]['projectId'] != project_id:
                raise ValueError(f'Unknown or foreign task list: {list_id}')
            activity_id = uid('list', list_id)
        elif task.get('phase'):
            key = (project_id, task['phase'])
            if key not in phases:
                phases[key] = uid('phase', f'{project_id}:{task["phase"]}')
                add('pz_activity', uuid=phases[key], project_uuid=uid('project', project_id),
                    activity_parent_uuid=uid('activity-root', project_id), name=task['phase'])
            activity_id = phases[key]
        else:
            activity_id = uid('activity-root', project_id)
        kind = task.get('kind', 'task')
        status = task.get('status', 'todo')
        if kind == 'milestone':
            if status not in ('done', 'todo', 'ready', 'validation', 'in_progress'):
                raise ValueError(f'Unknown milestone status: {status}')
            add('pz_milestone', uuid=uid('milestone', task['id']), activity_uuid=activity_id,
                name=task['title'], description=task.get('description'), end_date=task.get('endDate'),
                state=int(status == 'done'), key_rank=task.get('position'))
            tag_table = 'pz_milestone_tags'; key_column = 'milestone_uuid'
        elif kind == 'task':
            if status not in TASK_STATUSES and status not in ('ready', 'validation'):
                raise ValueError(f'Unknown task status: {status}')
            status_id = TASK_STATUSES[status][0] if status in TASK_STATUSES else uid('task-status', f'{project_id}:{status}')
            add('pz_task', uuid=uid('task', task['id']), activity_uuid=activity_id,
                name=task['title'], description=task.get('description'), start_date=task.get('startDate'),
                end_date=task.get('endDate'), percent_complete=task.get('progress'),
                status_uuid=status_id, activity_key_rank=task.get('position'))
            tag_table = 'pz_task_tags'; key_column = 'task_uuid'
            assignee = task.get('assigneeId')
            if assignee:
                if assignee not in resources:
                    raise ValueError(f'Unknown task assignee: {assignee}')
                add('pz_allocation', uuid=uid('allocation', task['id']), task_uuid=uid('task', task['id']),
                    resource_uuid=uid('resource', assignee), allocated_hours=task.get('allocatedHours', 0),
                    percent_complete=task.get('progress'))
        else:
            raise ValueError(f'Unknown task kind: {kind}')
        for tag in task.get('tags', []):
            add(tag_table, **{key_column: uid(kind, task['id']), 'tags': tag})
    # Membership is explicit or inferred from assignments and historical time, never from a milestone allocation.
    members = {}
    for project in data['projects']:
        for resource_id in project.get('projectRoles', {}):
            members[(project['id'], resource_id)] = project['projectRoles'][resource_id]
        if project.get('createdByResourceId'):
            members.setdefault((project['id'], project['createdByResourceId']), 'collaborator')
    for resource in data['resources']:
        for project_id in resource.get('projectIds', []):
            members.setdefault((project_id, resource['id']), 'collaborator')
    for task in data['tasks']:
        if task.get('assigneeId'):
            members.setdefault((task['projectId'], task['assigneeId']), 'collaborator')
    for entry in data['timeEntries']:
        task = tasks.get(entry['taskId'])
        if task:
            members.setdefault((task['projectId'], entry['resourceId']), 'collaborator')
    for (project_id, resource_id), role in sorted(members.items()):
        if project_id not in projects or resource_id not in resources or role not in PROJECT_ROLES:
            raise ValueError(f'Invalid project member: {project_id}, {resource_id}, {role}')
        member_id = uid('project-member', f'{project_id}:{resource_id}')
        add('pz_project_member', uuid=member_id, project_uuid=uid('project', project_id),
            member_uuid=uid('resource', resource_id), role_uuid=ROLES[PROJECT_ROLES[role]], deactivated=0)
        add('pz_project_project_member', project_uuid=uid('project', project_id), resources_uuid=member_id)
    for entry in data['timeEntries']:
        task = tasks.get(entry['taskId'])
        if task is None or task.get('kind', 'task') != 'task' or entry['resourceId'] not in resources:
            raise ValueError(f'Time record references unknown resource or non-task: {entry["id"]}')
        # recording_date is the sole business date; recording_day was removed from the target schema.
        add('pz_time_record', uuid=uid('time', entry['id']), task_uuid=uid('task', entry['taskId']),
            resource_uuid=uid('resource', entry['resourceId']), recording_date=entry['date'],
            time_spent=entry['hours'])
    for task in data['tasks']:
        predecessor_id = task.get('dependsOnId')
        if not predecessor_id:
            continue
        before = tasks.get(predecessor_id)
        if before is None or before['projectId'] != task['projectId']:
            raise ValueError(f'Invalid predecessor of task {task["id"]}')
        origin_type = 2 if before.get('kind') == 'milestone' else 1
        target_type = 2 if task.get('kind') == 'milestone' else 1
        add('pz_constraint', uuid=uid('constraint', task['id']), project_uuid=uid('project', task['projectId']),
            origin_entity_type=origin_type, origin_entity_uuid=uid('milestone' if origin_type == 2 else 'task', predecessor_id),
            target_entity_type=target_type, target_entity_uuid=uid('milestone' if target_type == 2 else 'task', task['id']),
            origin_date_type=0, target_date_type=0 if target_type == 2 else 1,
            constraint_type=0, offset_days=0, time_unit='DAY')
        target_date = task.get('endDate') if target_type == 2 else task.get('startDate')
        if before.get('endDate') and target_date and target_date < before['endDate']:
            report['date_conflicts'].append({'predecessor': predecessor_id, 'successor': task['id'],
                                             'predecessor_end': before['endDate'], 'successor_date': target_date})
    discussions = {}
    for comment in data['comments']:
        task_id = comment.get('taskId')
        project_id = comment.get('projectId') or (tasks[task_id]['projectId'] if task_id in tasks else None)
        if not project_id or project_id not in projects or (task_id and tasks[task_id]['projectId'] != project_id):
            raise ValueError(f'Unknown comment context: {comment["id"]}')
        entity_type, entity_id = (1, uid('task' if tasks[task_id].get('kind') != 'milestone' else 'milestone', task_id)) if task_id else (4, uid('project', project_id))
        if task_id and tasks[task_id].get('kind') == 'milestone':
            entity_type = 2
        key = (project_id, entity_type, entity_id)
        if key not in discussions:
            discussion_id = uid('discussion', ':'.join(map(str, key)))
            add('pz_discussion', uuid=discussion_id, project_uuid=uid('project', project_id),
                entity_type=entity_type, entity_uuid=entity_id)
            discussions[key] = discussion_id
            if task_id:
                column = 'pz_milestone' if entity_type == 2 else 'pz_task'
                db.execute(f'UPDATE {column} SET discussion_uuid=? WHERE uuid=?', (discussion_id, entity_id))
            else:
                db.execute('UPDATE pz_project SET log_discussion_uuid=? WHERE uuid=?',
                           (discussion_id, uid('project', project_id)))
        author_id = comment.get('authorId')
        if author_id and author_id not in resources:
            raise ValueError(f'Unknown comment author: {author_id}')
        add('pz_comment', uuid=uid('comment', comment['id']), discussion_uuid=discussions[key],
            content=comment['body'], author_uuid=uid('resource', author_id) if author_id else None,
            created_date=comment.get('createdAt'), last_modified=comment.get('updatedAt'))
        for recipient in comment.get('mentionResourceIds', []):
            if recipient not in resources:
                raise ValueError(f'Unknown comment mention: {recipient}')
            add('pz_comment_resource', comment_uuid=uid('comment', comment['id']),
                recipients_uuid=uid('resource', recipient))
    categories = {expense['category'] for expense in data['expenses']}
    for category in sorted(categories):
        add('pz_expense_type', uuid=uid('expense-type', category), planzone_uuid=planzone_id, name=category)
    for expense in data['expenses']:
        if expense['projectId'] not in projects:
            raise ValueError(f'Unknown expense project: {expense["id"]}')
        add('pz_expense', uuid=uid('expense', expense['id']), project_uuid=uid('project', expense['projectId']),
            expense_type_uuid=uid('expense-type', expense['category']), name=expense['label'],
            planned_date=expense.get('plannedDate'), actual_date=expense.get('paidDate'),
            quantity=1, unit_amount=expense['amount'])
    report['imported'] = dict(sorted(counts.items()))
    report['source_to_target_ids'] = {
        table: {item['id']: uid('milestone' if table == 'tasks' and item.get('kind') == 'milestone'
                                else {'zones': 'zone', 'projects': 'project', 'tasks': 'task',
                                      'resources': 'resource', 'profiles': 'profile',
                                      'timeEntries': 'time', 'comments': 'comment', 'expenses': 'expense',
                                      'taskLists': 'list'}[table], item['id']) for item in data[table]}
        for table in ('zones', 'projects', 'tasks', 'resources', 'profiles', 'timeEntries',
                      'comments', 'expenses', 'taskLists')
    }
    imported_collections = {'zones', 'projects', 'tasks', 'resources', 'profiles', 'timeEntries',
                            'comments', 'expenses', 'taskLists'}
    report['not_imported'] = {table: len(data[table]) for table in TABLES
                              if table not in imported_collections and data[table]}
    report['warnings'] = [
        'All original workspace JSON is preserved in the separate source-json sidecar (not authentication tables).',
        'Auth accounts, password hashes and sessions are NOT imported; configure PZ7 access separately.',
        'Unmapped fields include time validation, notes, historical rate/EqJT snapshots, project weather and resource colors.',
        'Daily rate is copied as cost with no proven PZ7 unit conversion; inspect PZ7 cost semantics before billing.',
        'Milestone assignee and non-done statuses have no equivalent in pz_milestone and remain in the sidecar.',
        'Inferred project memberships and custom statuses require validation against PZ7 business rules.',
        'No source dates or amounts were changed; AT_LEAST constraints can conflict with existing task dates.',
    ]
    return report


def publish_without_replacing(staging, output):
    """Publish a complete directory, refusing an existing destination even in a race (Linux)."""
    libc = ctypes.CDLL(None, use_errno=True)
    rename = libc.renameat2
    rename.argtypes = (ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint)
    rename.restype = ctypes.c_int
    if rename(-100, os.fsencode(staging), -100, os.fsencode(output), 1) != 0:  # RENAME_NOREPLACE
        code = ctypes.get_errno()
        if code == errno.EEXIST:
            raise ValueError(f'Refusing to overwrite existing output: {output}')
        raise OSError(code, os.strerror(code), str(output))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, default=Path('data/planzone.sqlite'))
    parser.add_argument('--schema', type=Path, default=Path('planzone_pz_sans_recording_day.sqlite'))
    parser.add_argument('--output', type=Path, required=True, help='New output directory (published only when complete)')
    args = parser.parse_args()
    output = args.output.absolute()
    if output.exists():
        parser.error(f'Refusing to overwrite existing output: {output}')
    source = sqlite3.connect(f'file:{args.source.absolute()}?mode=ro', uri=True)
    schema = sqlite3.connect(f'file:{args.schema.absolute()}?mode=ro', uri=True)
    staging = None
    target = None
    try:
        data = read_source(source)
        staging = Path(tempfile.mkdtemp(prefix='.pz7-import-', dir=output.parent))
        db_path = staging / 'workspace.sqlite'
        snapshot = staging / 'source-json.json'
        report_path = staging / 'report.json'
        # Backup copies the consistent schema snapshot into a private new file.
        fd = os.open(db_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        os.close(fd)
        target = sqlite3.connect(db_path)
        schema.backup(target)
        target.execute('PRAGMA foreign_keys = ON')
        target.execute('BEGIN IMMEDIATE')
        report = migrate(target, data)
        violations = target.execute('PRAGMA foreign_key_check').fetchall()
        if violations:
            raise ValueError(f'Foreign key violations: {violations[:5]}')
        target.commit()
        if target.execute('PRAGMA quick_check').fetchone()[0] != 'ok':
            raise ValueError('SQLite quick_check failed')
        target.close()
        target = None
        def save(path, content):
            fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(fd, 'w', encoding='utf-8') as stream:
                json.dump(content, stream, ensure_ascii=False, indent=2)
                stream.write('\n')
        save(snapshot, data)
        report['snapshot_sha256'] = hashlib.sha256(snapshot.read_bytes()).hexdigest()
        report['workspace_sha256'] = hashlib.sha256(db_path.read_bytes()).hexdigest()
        save(report_path, report)
        publish_without_replacing(staging, output)  # publish the complete bundle atomically
        staging = None
        print(json.dumps({'output': str(output / 'workspace.sqlite'),
                          'snapshot': str(output / 'source-json.json'),
                          'report': str(output / 'report.json'), 'imported': report['imported'],
                          'date_conflicts': len(report['date_conflicts'])}, ensure_ascii=False, indent=2))
    finally:
        if target is not None:
            target.rollback()
            target.close()
        if staging is not None:
            shutil.rmtree(staging)
        source.close()
        schema.close()


if __name__ == '__main__':
    try:
        main()
    except (ValueError, sqlite3.Error, OSError) as exc:
        print(f'Migration failed: {exc}', file=sys.stderr)
        sys.exit(1)
