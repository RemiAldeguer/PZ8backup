-- Qualified PZ7 resource privileges and configurable screen access.
-- Deliberate hardening: role assignment never inherits the legacy raw resource:update escalation.
SET ROLE pz8_owner;

CREATE FUNCTION pz8.resource_field_names() RETURNS text[]
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog
AS $function$
    SELECT ARRAY['name','description','type','affiliation','profession','cost',
        'invitationAccepted','avatarUrl','tags','attributes','integratedAt','role',
        'weeklyCalendar','managers','organizationalUnit','deactivated']::text[]
$function$;

CREATE TABLE pz8.roles (
    planzone_id uuid NOT NULL REFERENCES pz8.planzones(id),
    id uuid NOT NULL,
    name varchar(256) NOT NULL CHECK (char_length(btrim(name)) > 0),
    label varchar(256) NOT NULL CHECK (char_length(btrim(label)) > 0),
    coarse_role varchar(32) NOT NULL CHECK
        (coarse_role IN ('administrator','project_creator','user','visitor')),
    privileges text[] NOT NULL DEFAULT '{}',
    uneditable_fields text[] NOT NULL DEFAULT '{}'
        CHECK (uneditable_fields <@ pz8.resource_field_names()
            AND array_position(uneditable_fields, NULL) IS NULL),
    PRIMARY KEY (planzone_id, id),
    UNIQUE (planzone_id, name)
);
CREATE TABLE pz8.access_settings (
    planzone_id uuid PRIMARY KEY REFERENCES pz8.planzones(id),
    resource_allowed_roles text[] NOT NULL DEFAULT ARRAY['pz_admin']::text[]
        CHECK (array_position(resource_allowed_roles, NULL) IS NULL)
);

CREATE FUNCTION pz8.seed_access_roles(selected_planzone uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $function$
BEGIN
    INSERT INTO pz8.roles(planzone_id,id,name,label,coarse_role,privileges,uneditable_fields)
    VALUES
        (selected_planzone,gen_random_uuid(),'pz_admin','Administrateur','administrator',
            ARRAY['resource:create','resource:update','resource:delete',
                'usercontext:create','usercontext:update','usercontext:delete'], '{}'),
        (selected_planzone,gen_random_uuid(),'pz_under_admin','Créateur de projets','project_creator',
            ARRAY['resource:create','resource:update','usercontext:update'],
            ARRAY['description','name','type','affiliation','profession','cost',
                'invitationAccepted','avatarUrl','tags','attributes']),
        (selected_planzone,gen_random_uuid(),'pz_user','Utilisateur','user',
            ARRAY['resource:create','resource:update','usercontext:update'],
            ARRAY['description','name','type','affiliation','profession','cost',
                'invitationAccepted','avatarUrl','tags','attributes']),
        (selected_planzone,gen_random_uuid(),'pz_visitor','Visiteur','visitor',
            ARRAY['usercontext:update'], '{}')
    ON CONFLICT (planzone_id,name) DO NOTHING;
    INSERT INTO pz8.access_settings(planzone_id) VALUES (selected_planzone)
        ON CONFLICT DO NOTHING;
END
$function$;
CREATE FUNCTION pz8.initialize_planzone_access() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $function$
BEGIN
    PERFORM pz8.seed_access_roles(NEW.id);
    RETURN NEW;
END
$function$;
CREATE TRIGGER planzone_access_seed AFTER INSERT ON pz8.planzones
    FOR EACH ROW EXECUTE FUNCTION pz8.initialize_planzone_access();
-- FORCE RLS has no owner read policy on Planzones; seed existing tenants through clients.
-- Installation is controlled by the migration owner, never by runtime privileges.
ALTER TABLE pz8.planzones DISABLE ROW LEVEL SECURITY;
SELECT pz8.seed_access_roles(id) FROM pz8.planzones;
ALTER TABLE pz8.planzones ENABLE ROW LEVEL SECURITY;

ALTER TABLE pz8.memberships ADD COLUMN role_id uuid;
ALTER TABLE pz8.memberships ADD CONSTRAINT membership_scoped_role
    FOREIGN KEY (planzone_id,role_id) REFERENCES pz8.roles(planzone_id,id);
ALTER TABLE pz8.resources ADD COLUMN role_id uuid;
ALTER TABLE pz8.resources ADD COLUMN non_editable_fields text[] NOT NULL DEFAULT '{}'
    CHECK (non_editable_fields <@ pz8.resource_field_names()
        AND array_position(non_editable_fields, NULL) IS NULL);
ALTER TABLE pz8.resources ADD CONSTRAINT resource_scoped_role
    FOREIGN KEY (planzone_id,role_id) REFERENCES pz8.roles(planzone_id,id);

-- NULL membership role_id preserves installations provisioned with the original coarse role.
-- Once a role is explicitly assigned its scoped definition is authoritative.
CREATE FUNCTION pz8.effective_access_role(selected_planzone uuid) RETURNS uuid
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = pg_catalog
AS $function$
    SELECT r.id FROM pz8.memberships m JOIN pz8.roles r
        ON r.planzone_id = m.planzone_id
        AND ((m.role_id IS NOT NULL AND r.id = m.role_id)
            OR (m.role_id IS NULL AND r.name = CASE m.role
                WHEN 'administrator' THEN 'pz_admin'
                WHEN 'project_creator' THEN 'pz_under_admin'
                WHEN 'user' THEN 'pz_user' WHEN 'visitor' THEN 'pz_visitor' END))
    WHERE m.planzone_id = selected_planzone
        AND m.identity_id = NULLIF(current_setting('pz8.identity_id',true),'')::uuid
        AND pz8.has_planzone_access(selected_planzone,false)
$function$;

-- Owner is still subject to tenant scope when definer functions inspect resources.
CREATE POLICY resources_owner_scope ON pz8.resources FOR ALL TO pz8_owner
    USING (pz8.has_planzone_access(planzone_id,false))
    WITH CHECK (pz8.has_planzone_access(planzone_id,false));

CREATE FUNCTION pz8.resource_field_editable(selected_planzone uuid, field_name text)
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE SET search_path = pg_catalog
AS $function$
    SELECT COALESCE(field_name = ANY(pz8.resource_field_names())
        AND field_name <> 'role'
        AND 'resource:update' = ANY(r.privileges)
        AND NOT field_name = ANY(r.uneditable_fields)
        AND NOT EXISTS (
            SELECT 1 FROM pz8.resources actor_profile
            WHERE actor_profile.planzone_id = selected_planzone
                AND actor_profile.identity_id = NULLIF(current_setting('pz8.identity_id',true),'')::uuid
                AND field_name = ANY(actor_profile.non_editable_fields)
        ), false)
    FROM pz8.roles r WHERE r.planzone_id = selected_planzone
        AND r.id = pz8.effective_access_role(selected_planzone)
    UNION ALL SELECT false WHERE pz8.effective_access_role(selected_planzone) IS NULL
$function$;

CREATE FUNCTION pz8.has_capability(selected_planzone uuid, capability text)
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE SET search_path = pg_catalog
AS $function$
    SELECT COALESCE(CASE capability
        WHEN 'resource:read' THEN r.name = ANY(s.resource_allowed_roles)
        WHEN 'resource:create' THEN 'resource:create' = ANY(r.privileges)
        WHEN 'resource:edit' THEN 'resource:update' = ANY(r.privileges)
            AND pz8.resource_field_editable(selected_planzone,'name')
        WHEN 'invitation:manage' THEN r.name = 'pz_admin'
            AND 'resource:create' = ANY(r.privileges) AND 'usercontext:create' = ANY(r.privileges)
        WHEN 'resource:manage-access' THEN r.name = 'pz_admin'
        ELSE false END, false)
    FROM pz8.roles r JOIN pz8.access_settings s ON s.planzone_id = r.planzone_id
    WHERE r.planzone_id = selected_planzone AND r.id = pz8.effective_access_role(selected_planzone)
    UNION ALL SELECT false WHERE pz8.effective_access_role(selected_planzone) IS NULL
$function$;
CREATE FUNCTION pz8.access_permissions(selected_planzone uuid) RETURNS text[]
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = pg_catalog
AS $function$
    SELECT COALESCE(array_agg(capability ORDER BY capability),'{}'::text[])
    FROM unnest(ARRAY['resource:read','resource:create','resource:edit',
        'invitation:manage','resource:manage-access']::text[]) capability
    WHERE pz8.has_capability(selected_planzone,capability)
$function$;
CREATE FUNCTION pz8.editable_resource_fields(selected_planzone uuid) RETURNS text[]
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = pg_catalog
AS $function$
    SELECT COALESCE(array_agg(field_name ORDER BY field_name),'{}'::text[])
    FROM unnest(pz8.resource_field_names()) field_name
    WHERE pz8.resource_field_editable(selected_planzone,field_name)
$function$;
CREATE FUNCTION pz8.access_roles(selected_planzone uuid)
RETURNS TABLE(id uuid,name text,label text)
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = pg_catalog
AS $function$
    SELECT r.id,r.name::text,r.label::text FROM pz8.roles r
    WHERE r.planzone_id = selected_planzone AND pz8.has_planzone_access(selected_planzone,false)
    ORDER BY r.name
$function$;

CREATE FUNCTION pz8.initialize_resource_access() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $function$
BEGIN
    IF NEW.type = 'HUMAN' AND NEW.role_id IS NULL THEN
        SELECT r.id INTO NEW.role_id FROM pz8.memberships m JOIN pz8.roles r
            ON r.planzone_id = m.planzone_id
            AND ((m.role_id IS NOT NULL AND r.id = m.role_id)
                OR (m.role_id IS NULL AND r.name = CASE m.role
                    WHEN 'administrator' THEN 'pz_admin' WHEN 'project_creator' THEN 'pz_under_admin'
                    WHEN 'user' THEN 'pz_user' WHEN 'visitor' THEN 'pz_visitor' END))
        WHERE m.planzone_id = NEW.planzone_id AND m.identity_id = NEW.identity_id;
        IF NEW.role_id IS NULL THEN
            SELECT r.id INTO NEW.role_id FROM pz8.roles r
                WHERE r.planzone_id = NEW.planzone_id AND r.name = 'pz_user';
        END IF;
    END IF;
    RETURN NEW;
END
$function$;
CREATE TRIGGER resource_access_default BEFORE INSERT ON pz8.resources
    FOR EACH ROW EXECUTE FUNCTION pz8.initialize_resource_access();
ALTER TABLE pz8.resources DISABLE ROW LEVEL SECURITY;
UPDATE pz8.resources res SET role_id = r.id FROM pz8.memberships m JOIN pz8.roles r
    ON r.planzone_id = m.planzone_id
    AND ((m.role_id IS NOT NULL AND r.id = m.role_id)
        OR (m.role_id IS NULL AND r.name = CASE m.role
            WHEN 'administrator' THEN 'pz_admin' WHEN 'project_creator' THEN 'pz_under_admin'
            WHEN 'user' THEN 'pz_user' WHEN 'visitor' THEN 'pz_visitor' END))
    WHERE res.planzone_id = m.planzone_id AND res.identity_id = m.identity_id;
ALTER TABLE pz8.resources ENABLE ROW LEVEL SECURITY;

DROP POLICY resources_read ON pz8.resources;
CREATE POLICY resources_read ON pz8.resources FOR SELECT TO pz8_runtime
    USING (pz8.has_planzone_access(planzone_id,false));
DROP POLICY resources_insert ON pz8.resources;
CREATE POLICY resources_insert ON pz8.resources FOR INSERT TO pz8_runtime
    WITH CHECK (pz8.has_capability(planzone_id,'resource:create') AND NOT deactivated AND version = 0
        AND (type <> 'HUMAN' OR (identity_id IS NOT NULL AND pz8.member_available_for_resource(identity_id))));
DROP POLICY resources_update ON pz8.resources;
CREATE POLICY resources_update ON pz8.resources FOR UPDATE TO pz8_runtime
    USING (pz8.has_capability(planzone_id,'resource:edit') AND pz8.resource_field_editable(planzone_id,'name')
        AND NOT 'name' = ANY(non_editable_fields))
    WITH CHECK (pz8.has_capability(planzone_id,'resource:edit') AND pz8.resource_field_editable(planzone_id,'name')
        AND NOT 'name' = ANY(non_editable_fields));
-- Target-profile locks are an additional PZ8 guarantee. Actor role restrictions remain intact.
-- The scoped owner policy lets the authorized assignment function remove a target lock.
-- Newly added authority columns must not inherit the old table-wide INSERT grant.
REVOKE INSERT ON pz8.resources FROM pz8_runtime;
GRANT INSERT (planzone_id,id,name,description,type,identity_id) ON pz8.resources TO pz8_runtime;

DROP POLICY resource_operations_read ON pz8.resource_operations;
CREATE POLICY resource_operations_read ON pz8.resource_operations FOR SELECT TO pz8_runtime
    USING (pz8.has_planzone_access(planzone_id,false)
        AND actor_id = NULLIF(current_setting('pz8.identity_id',true),'')::uuid);
DROP POLICY resource_operations_insert ON pz8.resource_operations;
CREATE POLICY resource_operations_insert ON pz8.resource_operations FOR INSERT TO pz8_runtime
    WITH CHECK (pz8.has_planzone_access(planzone_id,false)
        AND actor_id = NULLIF(current_setting('pz8.identity_id',true),'')::uuid);
DROP POLICY resource_audit_read ON pz8.resource_audit;
CREATE POLICY resource_audit_read ON pz8.resource_audit FOR SELECT TO pz8_runtime
    USING (pz8.has_capability(planzone_id,'resource:read'));
DROP POLICY resource_audit_insert ON pz8.resource_audit;
CREATE POLICY resource_audit_insert ON pz8.resource_audit FOR INSERT TO pz8_runtime
    WITH CHECK (pz8.has_planzone_access(planzone_id,false)
        AND actor_id = NULLIF(current_setting('pz8.identity_id',true),'')::uuid);
CREATE POLICY resource_audit_owner_insert ON pz8.resource_audit FOR INSERT TO pz8_owner
    WITH CHECK (pz8.has_planzone_access(planzone_id,false)
        AND actor_id = NULLIF(current_setting('pz8.identity_id',true),'')::uuid);
ALTER TABLE pz8.resource_audit DROP CONSTRAINT resource_audit_event_type_check;
ALTER TABLE pz8.resource_audit ADD CONSTRAINT resource_audit_event_type_check
    CHECK (event_type IN ('CREATED','REGISTERED_MEMBER','RENAMED','ACCESS_CHANGED'));

CREATE FUNCTION pz8.assign_resource_access(target_resource uuid,target_role uuid,blocked_fields text[])
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $function$
DECLARE selected_planzone uuid; actor uuid; authority text; selected_coarse text;
    linked_identity uuid; updated_version bigint; selected_type text;
BEGIN
    selected_planzone := NULLIF(current_setting('pz8.planzone_id',true),'')::uuid;
    actor := NULLIF(current_setting('pz8.identity_id',true),'')::uuid;
    IF selected_planzone IS NULL OR actor IS NULL THEN RETURN 'denied'; END IF;
    authority := pz8.authorize_planzone(actor,selected_planzone,true);
    IF authority IS NULL OR NOT pz8.has_capability(selected_planzone,'resource:manage-access') THEN
        RETURN 'denied';
    END IF;
    IF blocked_fields IS NULL OR NOT blocked_fields <@ pz8.resource_field_names()
        OR array_position(blocked_fields,NULL) IS NOT NULL THEN RETURN 'invalid_fields'; END IF;
    SELECT r.coarse_role INTO selected_coarse FROM pz8.roles r
        WHERE r.planzone_id = selected_planzone AND r.id = target_role;
    IF selected_coarse IS NULL THEN RETURN 'role_unavailable'; END IF;
    SELECT res.identity_id,res.type INTO linked_identity,selected_type FROM pz8.resources res
        WHERE res.planzone_id = selected_planzone AND res.id = target_resource FOR UPDATE;
    IF NOT FOUND THEN RETURN 'resource_unavailable'; END IF;
    UPDATE pz8.resources SET role_id = target_role,
        non_editable_fields = ARRAY(SELECT DISTINCT field_name FROM unnest(blocked_fields) field_name ORDER BY field_name),
        version = version + 1,updated_at = clock_timestamp()
        WHERE planzone_id = selected_planzone AND id = target_resource
        RETURNING version INTO updated_version;
    IF linked_identity IS NOT NULL THEN
        UPDATE pz8.memberships SET role_id = target_role,role = selected_coarse
            WHERE planzone_id = selected_planzone AND identity_id = linked_identity;
    END IF;
    INSERT INTO pz8.resource_audit(id,planzone_id,resource_id,actor_id,operation_id,event_type,resource_type,resource_version)
        VALUES(gen_random_uuid(),selected_planzone,target_resource,actor,gen_random_uuid(),
            'ACCESS_CHANGED',selected_type,updated_version);
    UPDATE pz8.planzone_security_state SET security_version = security_version + 1
        WHERE planzone_id = selected_planzone;
    RETURN 'ok';
END
$function$;

REVOKE ALL ON pz8.roles,pz8.access_settings FROM PUBLIC,pz8_runtime;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA pz8 FROM PUBLIC;
GRANT EXECUTE ON FUNCTION pz8.has_capability(uuid,text),pz8.resource_field_editable(uuid,text),
    pz8.access_permissions(uuid),pz8.editable_resource_fields(uuid),pz8.access_roles(uuid),
    pz8.assign_resource_access(uuid,uuid,text[]),pz8.resource_field_names() TO pz8_runtime;
RESET ROLE;
