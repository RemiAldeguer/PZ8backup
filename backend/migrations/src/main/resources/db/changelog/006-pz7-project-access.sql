SET ROLE pz8_owner;
ALTER TABLE pz8.zones ALTER COLUMN name TYPE varchar(256);
ALTER TABLE pz8.zones ADD COLUMN saving_templates boolean NOT NULL DEFAULT false;
ALTER TABLE pz8.zones ADD COLUMN version bigint NOT NULL DEFAULT 0 CHECK (version >= 0);
ALTER TABLE pz8.roles ADD COLUMN zone_uneditable_fields text[] NOT NULL DEFAULT '{}'
    CHECK (zone_uneditable_fields <@ ARRAY['name','description','color','savingTemplates','planzone','projects','groups']::text[]
        AND array_position(zone_uneditable_fields,NULL) IS NULL);

CREATE TABLE pz8.projects (
    planzone_id uuid NOT NULL,
    id uuid NOT NULL,
    zone_id uuid NOT NULL,
    name varchar(256) NOT NULL CHECK (char_length(btrim(name)) > 0),
    template boolean NOT NULL DEFAULT false,
    status_code text,
    version bigint NOT NULL DEFAULT 0 CHECK (version >= 0),
    PRIMARY KEY (planzone_id,id),
    FOREIGN KEY (planzone_id,zone_id) REFERENCES pz8.zones(planzone_id,id)
);
CREATE INDEX projects_name_page ON pz8.projects(planzone_id,name COLLATE "C",id);
CREATE TABLE pz8.project_roles (
    planzone_id uuid NOT NULL REFERENCES pz8.planzones(id),
    id uuid NOT NULL,
    name varchar(256) NOT NULL,
    label varchar(256) NOT NULL,
    privileges text[] NOT NULL,
    uneditable_fields text[] NOT NULL DEFAULT '{}',
    PRIMARY KEY (planzone_id,id),
    UNIQUE (planzone_id,name)
);
CREATE TABLE pz8.zone_members (
    planzone_id uuid NOT NULL,
    zone_id uuid NOT NULL,
    resource_id uuid NOT NULL,
    role_id uuid,
    PRIMARY KEY (planzone_id,zone_id,resource_id),
    FOREIGN KEY (planzone_id,zone_id) REFERENCES pz8.zones(planzone_id,id),
    FOREIGN KEY (planzone_id,resource_id) REFERENCES pz8.resources(planzone_id,id),
    FOREIGN KEY (planzone_id,role_id) REFERENCES pz8.roles(planzone_id,id)
);
CREATE TABLE pz8.project_members (
    planzone_id uuid NOT NULL,
    project_id uuid NOT NULL,
    resource_id uuid NOT NULL,
    role_id uuid,
    deactivated boolean NOT NULL DEFAULT false,
    version bigint NOT NULL DEFAULT 0 CHECK (version >= 0),
    PRIMARY KEY (planzone_id,project_id,resource_id),
    FOREIGN KEY (planzone_id,project_id) REFERENCES pz8.projects(planzone_id,id),
    FOREIGN KEY (planzone_id,resource_id) REFERENCES pz8.resources(planzone_id,id),
    FOREIGN KEY (planzone_id,role_id) REFERENCES pz8.project_roles(planzone_id,id)
);
CREATE INDEX project_members_resource ON pz8.project_members(planzone_id,resource_id,project_id);
CREATE INDEX zone_members_resource ON pz8.zone_members(planzone_id,resource_id,zone_id);
CREATE FUNCTION pz8.add_zone_creator() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $function$
BEGIN
    INSERT INTO pz8.zone_members(planzone_id,zone_id,resource_id)
        SELECT NEW.planzone_id,NEW.id,r.id FROM pz8.resources r
        WHERE r.planzone_id=NEW.planzone_id AND r.type='HUMAN' AND NOT r.deactivated
            AND r.identity_id=NULLIF(current_setting('pz8.identity_id',true),'')::uuid
        ON CONFLICT DO NOTHING;
    RETURN NEW;
END
$function$;
CREATE TRIGGER zone_creator_member AFTER INSERT ON pz8.zones FOR EACH ROW EXECUTE FUNCTION pz8.add_zone_creator();
CREATE TABLE pz8.scope_access_audit (
    id uuid PRIMARY KEY,
    planzone_id uuid NOT NULL REFERENCES pz8.planzones(id),
    actor_id uuid NOT NULL REFERENCES pz8.identities(id),
    scope_type text NOT NULL CHECK (scope_type IN ('ZONE','PROJECT')),
    scope_id uuid NOT NULL,
    resource_id uuid NOT NULL,
    event_type text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    FOREIGN KEY (planzone_id,resource_id) REFERENCES pz8.resources(planzone_id,id)
);

CREATE FUNCTION pz8.seed_project_access(selected_planzone uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $function$
BEGIN
    INSERT INTO pz8.project_roles(planzone_id,id,name,label,privileges,uneditable_fields) VALUES
        (selected_planzone,gen_random_uuid(),'pr_manager','Responsable',ARRAY['accessProjectDetails','activity:create','activity:delete','activity:update','allocation:create','allocation:delete','allocation:update','attachment:create','attachment:delete','attachment:update','beingAssignedToATask','changeTheProjectRoleOfAProjectMember','closeOrReopenATaskNotAssigned','comment:create','comment:delete','comment:update','constraint:create','constraint:delete','constraint:update','createTask','deleteAUserFromTheProject','discussion:create','discussion:delete','discussion:update','document:create','document:delete','document:update','event:create','event:delete','event:update','folder:create','folder:delete','folder:update','inviteAPlanzoneMemberToTheProject','milestone:create','milestone:delete','milestone:update','project:delete','project:update','projectmember:create','projectmember:delete','projectmember:update','projectresourcegroup:create','projectresourcegroup:delete','projectresourcegroup:update','seeAllProjectTasks','seeTheFullProjectSummary','seeTheListOfUsersInTheProject','status:create','status:delete','status:update','task:create','task:delete','task:update','timerecord:create','timerecord:delete','timerecord:update','updateAnyTask','updateProjectStatus','updateTaskIHaveCreated','zonemember:create']::text[],'{}'::text[]),
        (selected_planzone,gen_random_uuid(),'pr_worker','Participant',ARRAY['activity:create','activity:delete','activity:update','allocation:create','allocation:delete','allocation:update','attachment:create','attachment:delete','attachment:update','beingAssignedToATask','closeOrReopenATaskNotAssigned','comment:create','comment:delete','comment:update','discussion:create','discussion:delete','document:create','document:delete','document:update','event:create','event:delete','event:update','milestone:create','milestone:delete','milestone:update','project:update','seeAllProjectTasks','seeTheFullProjectSummary','seeTheListOfUsersInTheProject','task:create','task:delete','task:update','timerecord:create','timerecord:delete','timerecord:update','updateTaskIHaveCreated']::text[],ARRAY['description','name','color','wiki','publishedAt','lockedAt','template','allocatedBudget','status','activityRoot','zone','data','tags','attributes']::text[]),
        (selected_planzone,gen_random_uuid(),'pr_visitor','Visiteur',ARRAY['beingAssignedToATask','comment:create','comment:delete','comment:update','discussion:create','document:create','document:update','seeAllProjectTasks','seeTheFullProjectSummary','seeTheListOfUsersInTheProject']::text[],'{}'::text[])
    ON CONFLICT (planzone_id,name) DO NOTHING;
    UPDATE pz8.roles SET privileges = ARRAY(SELECT DISTINCT capability FROM unnest(privileges || ARRAY['activity:create','activity:delete','activity:update','allocation:create','allocation:delete','allocation:update','attachment:create','attachment:delete','attachment:update','calendarlink:create','calendarlink:delete','calendarlink:update','comment:create','comment:delete','comment:update','constraint:create','constraint:delete','constraint:update','discussion:create','discussion:delete','discussion:update','document:create','document:delete','document:update','event:create','event:delete','event:update','folder:create','folder:delete','folder:update','log:create','log:delete','log:update','milestone:create','milestone:delete','milestone:update','notification:create','planzone:update','planzoneresourcegroup:create','planzoneresourcegroup:delete','planzoneresourcegroup:update','project:create','project:delete','project:update','projectmember:create','projectmember:delete','projectmember:update','projectresourcegroup:create','projectresourcegroup:delete','projectresourcegroup:update','projectstatus:create','projectstatus:delete','projectstatus:update','resource:create','resource:delete','resource:update','resourcenotification:create','resourcenotification:delete','resourcenotification:update','status:create','status:delete','status:update','task:create','task:delete','task:update','timerecord:create','timerecord:delete','timerecord:update','usercontext:create','usercontext:delete','usercontext:update','weeklycalendar:create','weeklycalendar:delete','weeklycalendar:update','zone:create','zone:delete','zone:update','zonemember:create','zonemember:delete','zonemember:update','zoneresourcegroup:create','zoneresourcegroup:delete','zoneresourcegroup:update']::text[]) capability ORDER BY capability) WHERE planzone_id = selected_planzone AND name = 'pz_admin';
    UPDATE pz8.roles SET privileges = ARRAY(SELECT DISTINCT capability FROM unnest(privileges || ARRAY['activity:create','calendarlink:create','calendarlink:delete','calendarlink:update','discussion:create','discussion:delete','discussion:update','log:create','log:delete','log:update','planzone:update','project:create','project:update','projectmember:create','projectresourcegroup:create','resource:create','resource:update','resourcenotification:create','resourcenotification:update','usercontext:update','weeklycalendar:create','weeklycalendar:update','zone:update','zonemember:create']::text[]) capability ORDER BY capability) WHERE planzone_id = selected_planzone AND name = 'pz_under_admin';
    UPDATE pz8.roles SET privileges = ARRAY(SELECT DISTINCT capability FROM unnest(privileges || ARRAY['calendarlink:create','calendarlink:delete','calendarlink:update','log:create','log:delete','log:update','resource:create','resource:update','resourcenotification:create','resourcenotification:update','usercontext:update','weeklycalendar:create','weeklycalendar:update','zone:update','zonemember:create']::text[]) capability ORDER BY capability) WHERE planzone_id = selected_planzone AND name = 'pz_user';
    UPDATE pz8.roles SET privileges = ARRAY(SELECT DISTINCT capability FROM unnest(privileges || ARRAY['resourcenotification:create','resourcenotification:update','usercontext:update','weeklycalendar:update']::text[]) capability ORDER BY capability) WHERE planzone_id = selected_planzone AND name = 'pz_visitor';
    UPDATE pz8.roles SET zone_uneditable_fields=ARRAY['name','description','color','savingTemplates','planzone','projects','groups']::text[]
        WHERE planzone_id=selected_planzone AND name IN ('pz_under_admin','pz_user');
END
$function$;
CREATE FUNCTION pz8.initialize_project_access() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $function$
BEGIN PERFORM pz8.seed_project_access(NEW.id); RETURN NEW; END
$function$;
CREATE TRIGGER planzone_project_access_seed AFTER INSERT ON pz8.planzones
    FOR EACH ROW EXECUTE FUNCTION pz8.initialize_project_access();
SELECT pz8.seed_project_access(id) FROM pz8.planzones;

CREATE FUNCTION pz8.scope_global_role(selected_planzone uuid) RETURNS text
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = pg_catalog
AS $function$
    SELECT r.name::text FROM pz8.roles r WHERE r.planzone_id = selected_planzone
        AND r.id = pz8.effective_access_role(selected_planzone)
$function$;
CREATE FUNCTION pz8.has_global_scope_privilege(selected_planzone uuid,capability text) RETURNS boolean
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = pg_catalog
AS $function$
    SELECT COALESCE(EXISTS (SELECT 1 FROM pz8.roles r WHERE r.planzone_id=selected_planzone
        AND r.id=pz8.effective_access_role(selected_planzone) AND capability=ANY(r.privileges)),false)
$function$;
CREATE FUNCTION pz8.can_see_zone(selected_planzone uuid, selected_zone uuid) RETURNS boolean
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = pg_catalog
AS $function$
    SELECT pz8.has_planzone_access(selected_planzone,false) AND EXISTS (
        SELECT 1 FROM pz8.zones z WHERE z.planzone_id = selected_planzone AND z.id = selected_zone
        AND (z.saving_templates OR pz8.scope_global_role(selected_planzone) IN ('pz_admin','pz_under_admin') OR EXISTS (
            SELECT 1 FROM pz8.zone_members m JOIN pz8.resources r ON r.planzone_id = m.planzone_id AND r.id = m.resource_id
            WHERE m.planzone_id = selected_planzone AND m.zone_id = selected_zone AND NOT r.deactivated
                AND r.identity_id = NULLIF(current_setting('pz8.identity_id',true),'')::uuid)))
$function$;
CREATE POLICY zones_scope_owner_read ON pz8.zones FOR SELECT TO pz8_owner USING (true);
CREATE FUNCTION pz8.can_see_project(selected_planzone uuid, selected_project uuid) RETURNS boolean
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = pg_catalog
AS $function$
    SELECT pz8.has_planzone_access(selected_planzone,false) AND EXISTS (
        SELECT 1 FROM pz8.projects p WHERE p.planzone_id = selected_planzone AND p.id = selected_project
        AND (p.template OR pz8.scope_global_role(selected_planzone) = 'pz_admin' OR EXISTS (
            SELECT 1 FROM pz8.project_members m JOIN pz8.resources r ON r.planzone_id = m.planzone_id AND r.id = m.resource_id
            WHERE m.planzone_id = selected_planzone AND m.project_id = selected_project AND NOT m.deactivated
                AND NOT r.deactivated AND r.identity_id = NULLIF(current_setting('pz8.identity_id',true),'')::uuid)))
$function$;
CREATE FUNCTION pz8.scope_project_privileges(selected_planzone uuid, selected_project uuid) RETURNS text[]
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = pg_catalog
AS $function$
    SELECT COALESCE(array_agg(DISTINCT capability ORDER BY capability),'{}'::text[]) FROM (
        SELECT unnest(r.privileges) capability FROM pz8.roles r WHERE r.planzone_id = selected_planzone AND r.id = pz8.effective_access_role(selected_planzone)
        UNION SELECT unnest(pr.privileges) FROM pz8.project_members m
        JOIN pz8.resources res ON res.planzone_id = m.planzone_id AND res.id = m.resource_id
        JOIN pz8.project_roles pr ON pr.planzone_id = m.planzone_id AND pr.id = m.role_id
        WHERE m.planzone_id = selected_planzone AND m.project_id = selected_project AND NOT m.deactivated AND NOT res.deactivated
            AND res.identity_id = NULLIF(current_setting('pz8.identity_id',true),'')::uuid
    ) rights WHERE pz8.can_see_project(selected_planzone,selected_project)
$function$;
CREATE FUNCTION pz8.scope_project_fields(selected_planzone uuid, selected_project uuid) RETURNS text[]
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = pg_catalog
AS $function$
    SELECT COALESCE(array_agg(field_name ORDER BY field_name),'{}'::text[]) FROM
        unnest(ARRAY['description','name','color','wiki','publishedAt','lockedAt','template','allocatedBudget','status','activityRoot','zone','data','tags','attributes','integratedAt']) field_name
    WHERE 'project:update' = ANY(pz8.scope_project_privileges(selected_planzone,selected_project)) AND NOT EXISTS (
        SELECT 1 FROM pz8.project_members m JOIN pz8.resources res ON res.planzone_id = m.planzone_id AND res.id = m.resource_id
        JOIN pz8.project_roles pr ON pr.planzone_id = m.planzone_id AND pr.id = m.role_id
        WHERE m.planzone_id = selected_planzone AND m.project_id = selected_project AND NOT m.deactivated AND NOT res.deactivated
            AND res.identity_id = NULLIF(current_setting('pz8.identity_id',true),'')::uuid AND field_name = ANY(pr.uneditable_fields)
            AND pz8.scope_global_role(selected_planzone) IS DISTINCT FROM 'pz_admin')
$function$;
CREATE FUNCTION pz8.scope_zone_permissions(selected_planzone uuid, selected_zone uuid) RETURNS text[]
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = pg_catalog
AS $function$
    SELECT COALESCE(array_agg(capability ORDER BY capability),'{}'::text[]) FROM pz8.roles r,
        unnest(r.privileges) capability WHERE r.planzone_id = selected_planzone AND r.id = pz8.effective_access_role(selected_planzone)
        AND pz8.can_see_zone(selected_planzone,selected_zone) AND (capability LIKE 'zonemember:%' OR capability LIKE 'zone:%')
$function$;
CREATE FUNCTION pz8.scope_zone_fields(selected_planzone uuid,selected_zone uuid) RETURNS text[]
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = pg_catalog
AS $function$
    SELECT COALESCE(array_agg(field_name ORDER BY field_name),'{}'::text[]) FROM pz8.roles r,
        unnest(ARRAY['name','description','color','savingTemplates','planzone','projects','groups']::text[]) field_name
    WHERE r.planzone_id=selected_planzone AND r.id=pz8.effective_access_role(selected_planzone)
        AND pz8.can_see_zone(selected_planzone,selected_zone) AND 'zone:update'=ANY(r.privileges)
        AND NOT field_name=ANY(r.zone_uneditable_fields)
$function$;

ALTER TABLE pz8.projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE pz8.projects FORCE ROW LEVEL SECURITY;
CREATE POLICY projects_owner ON pz8.projects TO pz8_owner USING (true) WITH CHECK (true);
CREATE POLICY projects_read ON pz8.projects FOR SELECT TO pz8_runtime USING (pz8.can_see_project(planzone_id,id));
GRANT SELECT ON pz8.projects TO pz8_runtime;
DROP POLICY zones_read ON pz8.zones;
CREATE POLICY zones_read ON pz8.zones FOR SELECT TO pz8_runtime USING (pz8.can_see_zone(planzone_id,id));
DROP POLICY zones_insert ON pz8.zones;
CREATE POLICY zones_insert ON pz8.zones FOR INSERT TO pz8_runtime
    WITH CHECK (pz8.has_global_scope_privilege(planzone_id,'zone:create'));
-- Team and role catalogues are private: readers and mutations use scoped, bounded functions.
REVOKE ALL ON pz8.project_roles,pz8.project_members,pz8.zone_members,pz8.scope_access_audit FROM PUBLIC,pz8_runtime;

CREATE FUNCTION pz8.scope_role_catalogue()
RETURNS TABLE(id uuid,name text,label text)
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = pg_catalog
AS $function$
    SELECT r.id,r.name::text,r.label::text FROM pz8.project_roles r
    WHERE pz8.has_planzone_access(r.planzone_id,false) ORDER BY r.name
$function$;
CREATE FUNCTION pz8.allowed_project_roles(selected_planzone uuid, selected_resource uuid) RETURNS uuid[]
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = pg_catalog
AS $function$
    SELECT COALESCE(array_agg(pr.id ORDER BY pr.name),'{}'::uuid[]) FROM pz8.project_roles pr
    JOIN pz8.resources res ON res.planzone_id = pr.planzone_id AND res.id = selected_resource
    LEFT JOIN pz8.roles global_role ON global_role.planzone_id = res.planzone_id AND global_role.id = res.role_id
    WHERE pr.planzone_id = selected_planzone AND NOT res.deactivated
        AND (global_role.name IS DISTINCT FROM 'pz_visitor' OR pr.name = 'pr_visitor')
$function$;
CREATE FUNCTION pz8.require_scope(selected_project boolean, selected_scope uuid, capability text, authority boolean)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $function$
DECLARE selected_planzone uuid; actor uuid;
BEGIN
    selected_planzone := NULLIF(current_setting('pz8.planzone_id',true),'')::uuid;
    actor := NULLIF(current_setting('pz8.identity_id',true),'')::uuid;
    IF selected_planzone IS NULL OR actor IS NULL THEN RAISE EXCEPTION 'Scoped access denied' USING ERRCODE = 'PZ021'; END IF;
    IF authority AND pz8.authorize_planzone(actor,selected_planzone,true) IS NULL THEN
        RAISE EXCEPTION 'Scoped access denied' USING ERRCODE = 'PZ021';
    END IF;
    IF (selected_project AND NOT pz8.can_see_project(selected_planzone,selected_scope))
        OR (NOT selected_project AND NOT pz8.can_see_zone(selected_planzone,selected_scope)) THEN
        RAISE EXCEPTION 'Scope unavailable' USING ERRCODE = 'PZ020';
    END IF;
    IF capability IS NOT NULL AND NOT capability = ANY(CASE WHEN selected_project
        THEN pz8.scope_project_privileges(selected_planzone,selected_scope)
        ELSE pz8.scope_zone_permissions(selected_planzone,selected_scope) END) THEN
        RAISE EXCEPTION 'Scoped access denied' USING ERRCODE = 'PZ021';
    END IF;
    RETURN selected_planzone;
END
$function$;

CREATE FUNCTION pz8.list_scoped_members(selected_project boolean, selected_scope uuid, candidates boolean,
    prefix text, page_limit integer, after_name text, after_id uuid)
RETURNS TABLE(resource_id uuid,name text,type text,role_id uuid,deactivated boolean,version bigint,allowed_role_ids uuid[])
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $function$
DECLARE selected_planzone uuid;
BEGIN
    selected_planzone := pz8.require_scope(selected_project,selected_scope,NULL,false);
    IF candidates AND NOT ((selected_project AND 'projectmember:create' = ANY(pz8.scope_project_privileges(selected_planzone,selected_scope)))
        OR (NOT selected_project AND 'zonemember:create' = ANY(pz8.scope_zone_permissions(selected_planzone,selected_scope)))) THEN
        RAISE EXCEPTION 'Scoped access denied' USING ERRCODE = 'PZ021';
    END IF;
    IF page_limit IS NULL OR page_limit NOT BETWEEN 1 AND 101 OR prefix IS NULL OR char_length(prefix)>256
        OR (after_name IS NULL) <> (after_id IS NULL) THEN RAISE EXCEPTION 'Invalid scope query' USING ERRCODE = '22023'; END IF;
    RETURN QUERY SELECT res.id,res.name::text,res.type::text,pm.role_id,COALESCE(pm.deactivated,false),COALESCE(pm.version,0),
        pz8.allowed_project_roles(selected_planzone,res.id) FROM pz8.resources res
    LEFT JOIN pz8.project_members pm ON selected_project AND pm.planzone_id = res.planzone_id AND pm.project_id = selected_scope AND pm.resource_id = res.id
    LEFT JOIN pz8.zone_members zm ON NOT selected_project AND zm.planzone_id = res.planzone_id AND zm.zone_id = selected_scope AND zm.resource_id = res.id
    WHERE res.planzone_id = selected_planzone AND (NOT candidates OR NOT res.deactivated)
        AND (CASE WHEN selected_project THEN pm.resource_id IS NOT NULL ELSE zm.resource_id IS NOT NULL END) <> candidates
        AND res.name ILIKE replace(replace(replace(prefix,'\','\\'),'%','\%'),'_','\_') || '%' ESCAPE '\'
        AND (after_id IS NULL OR (res.name COLLATE "C",res.id) > (after_name COLLATE "C",after_id))
    ORDER BY res.name COLLATE "C",res.id LIMIT page_limit;
END
$function$;

CREATE FUNCTION pz8.scope_member_row(selected_planzone uuid,selected_project boolean,selected_scope uuid,selected_resource uuid)
RETURNS TABLE(resource_id uuid,name text,type text,role_id uuid,deactivated boolean,version bigint,allowed_role_ids uuid[])
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = pg_catalog
AS $function$
    SELECT res.id,res.name::text,res.type::text,pm.role_id,COALESCE(pm.deactivated,false),COALESCE(pm.version,0),
        pz8.allowed_project_roles(selected_planzone,res.id) FROM pz8.resources res
    LEFT JOIN pz8.project_members pm ON selected_project AND pm.planzone_id=res.planzone_id AND pm.project_id=selected_scope AND pm.resource_id=res.id
    LEFT JOIN pz8.zone_members zm ON NOT selected_project AND zm.planzone_id=res.planzone_id AND zm.zone_id=selected_scope AND zm.resource_id=res.id
    WHERE res.planzone_id=selected_planzone AND res.id=selected_resource
        AND CASE WHEN selected_project THEN pm.resource_id IS NOT NULL ELSE zm.resource_id IS NOT NULL END
$function$;

CREATE FUNCTION pz8.change_scope_member(selected_project boolean, selected_scope uuid, selected_resource uuid,
    operation text, selected_role_id uuid, member_deactivated boolean, expected_version bigint)
RETURNS TABLE(resource_id uuid,name text,type text,role_id uuid,deactivated boolean,version bigint,allowed_role_ids uuid[])
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $function$
DECLARE selected_planzone uuid; selected_zone uuid; resource_kind text; available boolean;
    member pz8.project_members; affected integer; needed_capability text;
BEGIN
    IF selected_project IS NULL OR operation IS NULL OR operation NOT IN ('ADD','UPDATE','REMOVE') OR (NOT selected_project AND operation = 'UPDATE') THEN
        RAISE EXCEPTION 'Invalid team operation' USING ERRCODE = '22023';
    END IF;
    needed_capability := CASE WHEN selected_project THEN 'projectmember:' ELSE 'zonemember:' END
        || CASE operation WHEN 'ADD' THEN 'create' WHEN 'UPDATE' THEN 'update' ELSE 'delete' END;
    selected_planzone := pz8.require_scope(selected_project,selected_scope,needed_capability,true);
    SELECT res.type,res.deactivated INTO resource_kind,available FROM pz8.resources res
        WHERE res.planzone_id = selected_planzone AND res.id = selected_resource;
    IF NOT FOUND OR (operation <> 'REMOVE' AND available) THEN RAISE EXCEPTION 'Resource unavailable' USING ERRCODE = 'PZ020'; END IF;
    IF selected_project AND operation <> 'REMOVE' THEN
        IF (resource_kind = 'HUMAN' AND selected_role_id IS NULL)
            OR (selected_role_id IS NOT NULL AND NOT selected_role_id = ANY(pz8.allowed_project_roles(selected_planzone,selected_resource))) THEN
            RAISE EXCEPTION 'Project role unavailable' USING ERRCODE = 'PZ022';
        END IF;
    END IF;
    IF selected_project THEN
        SELECT p.zone_id INTO selected_zone FROM pz8.projects p WHERE p.planzone_id = selected_planzone AND p.id = selected_scope;
        SELECT * INTO member FROM pz8.project_members m WHERE m.planzone_id = selected_planzone AND m.project_id = selected_scope AND m.resource_id = selected_resource;
        IF operation = 'ADD' THEN
            IF FOUND THEN
                IF member.role_id IS NOT DISTINCT FROM selected_role_id AND NOT member.deactivated THEN
                    RETURN QUERY SELECT * FROM pz8.scope_member_row(selected_planzone,true,selected_scope,selected_resource); RETURN;
                END IF;
                RAISE EXCEPTION 'Team state conflict' USING ERRCODE = 'PZ024';
            END IF;
            INSERT INTO pz8.project_members(planzone_id,project_id,resource_id,role_id) VALUES(selected_planzone,selected_scope,selected_resource,selected_role_id);
            INSERT INTO pz8.zone_members(planzone_id,zone_id,resource_id) VALUES(selected_planzone,selected_zone,selected_resource) ON CONFLICT DO NOTHING;
        ELSIF operation = 'UPDATE' THEN
            IF NOT FOUND THEN RAISE EXCEPTION 'Member unavailable' USING ERRCODE = 'PZ020'; END IF;
            IF expected_version IS NULL OR expected_version < 0 OR member.version <> expected_version THEN
                RAISE EXCEPTION 'Member version conflict' USING ERRCODE = 'PZ023';
            END IF;
            UPDATE pz8.project_members m SET role_id = selected_role_id,deactivated = member_deactivated,version = m.version + 1
                WHERE m.planzone_id = selected_planzone AND m.project_id = selected_scope AND m.resource_id = selected_resource;
        ELSE
            DELETE FROM pz8.project_members m WHERE m.planzone_id = selected_planzone AND m.project_id = selected_scope AND m.resource_id = selected_resource;
            GET DIAGNOSTICS affected = ROW_COUNT;
            IF affected = 0 THEN RETURN; END IF;
        END IF;
    ELSE
        IF operation = 'ADD' THEN
            INSERT INTO pz8.zone_members(planzone_id,zone_id,resource_id) VALUES(selected_planzone,selected_scope,selected_resource) ON CONFLICT DO NOTHING;
            GET DIAGNOSTICS affected = ROW_COUNT;
            IF affected = 0 THEN
                RETURN QUERY SELECT * FROM pz8.scope_member_row(selected_planzone,false,selected_scope,selected_resource); RETURN;
            END IF;
        ELSE
            DELETE FROM pz8.project_members m USING pz8.projects p WHERE p.planzone_id = selected_planzone AND p.zone_id = selected_scope
                AND m.planzone_id = p.planzone_id AND m.project_id = p.id AND m.resource_id = selected_resource;
            GET DIAGNOSTICS affected = ROW_COUNT;
            DELETE FROM pz8.zone_members m WHERE m.planzone_id = selected_planzone AND m.zone_id = selected_scope AND m.resource_id = selected_resource;
            IF NOT FOUND AND affected = 0 THEN RETURN; END IF;
        END IF;
    END IF;
    INSERT INTO pz8.scope_access_audit(id,planzone_id,actor_id,scope_type,scope_id,resource_id,event_type)
        VALUES(gen_random_uuid(),selected_planzone,NULLIF(current_setting('pz8.identity_id',true),'')::uuid,
            CASE WHEN selected_project THEN 'PROJECT' ELSE 'ZONE' END,selected_scope,selected_resource,operation);
    UPDATE pz8.planzone_security_state SET security_version = security_version + 1 WHERE planzone_id = selected_planzone;
    IF operation <> 'REMOVE' THEN
        RETURN QUERY SELECT * FROM pz8.scope_member_row(selected_planzone,selected_project,selected_scope,selected_resource);
    END IF;
END
$function$;

-- assign_resource_access already owns the Planzone UPDATE authority lock. Keep this
-- adaptation inside that same transaction, without changing the delivered 003 function.
-- A later global promotion never restores a project role which was explicitly reduced.
CREATE FUNCTION pz8.adapt_project_roles_after_global_downgrade() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $function$
DECLARE visitor_role_id uuid; actor uuid; changed_member record;
BEGIN
    IF NEW.role_id IS NOT DISTINCT FROM OLD.role_id OR NOT EXISTS (
        SELECT 1 FROM pz8.roles r WHERE r.planzone_id=NEW.planzone_id
            AND r.id=NEW.role_id AND r.name='pz_visitor') THEN
        RETURN NEW;
    END IF;
    SELECT r.id INTO visitor_role_id FROM pz8.project_roles r
        WHERE r.planzone_id=NEW.planzone_id AND r.name='pr_visitor';
    IF visitor_role_id IS NULL THEN
        RAISE EXCEPTION 'Project visitor role unavailable' USING ERRCODE='PZ022';
    END IF;
    actor := NULLIF(current_setting('pz8.identity_id',true),'')::uuid;
    FOR changed_member IN
        UPDATE pz8.project_members m SET role_id=visitor_role_id,version=m.version+1
        FROM pz8.project_roles previous_role
        WHERE m.planzone_id=NEW.planzone_id AND m.resource_id=NEW.id
            AND previous_role.planzone_id=m.planzone_id AND previous_role.id=m.role_id
            AND previous_role.name<>'pr_visitor'
        RETURNING m.project_id,m.version
    LOOP
        IF actor IS NOT NULL AND NEW.planzone_id=NULLIF(current_setting('pz8.planzone_id',true),'')::uuid
            AND pz8.has_planzone_access(NEW.planzone_id,false) THEN
            INSERT INTO pz8.scope_access_audit(id,planzone_id,actor_id,scope_type,scope_id,resource_id,event_type)
                VALUES(gen_random_uuid(),NEW.planzone_id,actor,'PROJECT',changed_member.project_id,NEW.id,'GLOBAL_ROLE_DOWNGRADED');
        END IF;
    END LOOP;
    RETURN NEW;
END
$function$;
CREATE TRIGGER resource_project_role_downgrade AFTER UPDATE OF role_id ON pz8.resources
    FOR EACH ROW EXECUTE FUNCTION pz8.adapt_project_roles_after_global_downgrade();

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA pz8 FROM PUBLIC;
GRANT EXECUTE ON FUNCTION pz8.can_see_zone(uuid,uuid),pz8.can_see_project(uuid,uuid),
    pz8.has_global_scope_privilege(uuid,text),
    pz8.scope_zone_permissions(uuid,uuid),pz8.scope_project_privileges(uuid,uuid),pz8.scope_project_fields(uuid,uuid),
    pz8.scope_zone_fields(uuid,uuid),
    pz8.scope_role_catalogue(),pz8.list_scoped_members(boolean,uuid,boolean,text,integer,text,uuid),
    pz8.change_scope_member(boolean,uuid,uuid,text,uuid,boolean,bigint) TO pz8_runtime;
RESET ROLE;
