-- First internal administrator-only people slice. These policies do not map all PZ7 rights.
SET ROLE pz8_owner;

CREATE TABLE pz8.resources (
    planzone_id uuid NOT NULL REFERENCES pz8.planzones(id),
    id uuid NOT NULL,
    name varchar(256) NOT NULL CHECK (char_length(btrim(name)) > 0),
    description varchar(5000) NOT NULL DEFAULT '',
    type varchar(16) NOT NULL CHECK (type IN ('HUMAN', 'VIRTUAL', 'MATERIAL')),
    identity_id uuid,
    deactivated boolean NOT NULL DEFAULT false,
    version bigint NOT NULL DEFAULT 0 CHECK (version >= 0),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (planzone_id, id),
    CONSTRAINT resource_scoped_member FOREIGN KEY (planzone_id, identity_id)
        REFERENCES pz8.memberships(planzone_id, identity_id),
    CONSTRAINT resource_member_unique UNIQUE (planzone_id, identity_id),
    CONSTRAINT resource_login_type CHECK (type = 'HUMAN' OR identity_id IS NULL)
);
CREATE INDEX resources_name_page ON pz8.resources(planzone_id, name COLLATE "C", id);

CREATE TABLE pz8.resource_operations (
    planzone_id uuid NOT NULL,
    actor_id uuid NOT NULL REFERENCES pz8.identities(id),
    operation_kind varchar(32) NOT NULL CHECK (operation_kind IN ('CREATE', 'REGISTER_MEMBER')),
    operation_id uuid NOT NULL,
    fingerprint varchar(64) NOT NULL CHECK (fingerprint ~ '^[0-9a-f]{64}$'),
    resource_id uuid NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (planzone_id, actor_id, operation_kind, operation_id),
    -- A receipt is claimed before the profile; both must exist when the transaction commits.
    CONSTRAINT resource_operation_profile FOREIGN KEY (planzone_id, resource_id)
        REFERENCES pz8.resources(planzone_id, id) DEFERRABLE INITIALLY DEFERRED
);

CREATE TABLE pz8.resource_audit (
    id uuid NOT NULL,
    planzone_id uuid NOT NULL,
    resource_id uuid NOT NULL,
    actor_id uuid NOT NULL REFERENCES pz8.identities(id),
    operation_id uuid NOT NULL,
    event_type varchar(32) NOT NULL CHECK (event_type IN ('CREATED', 'REGISTERED_MEMBER', 'RENAMED')),
    resource_type varchar(16) NOT NULL CHECK (resource_type IN ('HUMAN', 'VIRTUAL', 'MATERIAL')),
    resource_version bigint NOT NULL CHECK (resource_version >= 0),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (planzone_id, id),
    FOREIGN KEY (planzone_id, resource_id) REFERENCES pz8.resources(planzone_id, id)
);
CREATE INDEX resource_audit_profile ON pz8.resource_audit(planzone_id, resource_id, created_at, id);

-- Exposes only availability of an exact member of the current administrator's selected client.
-- The unit of work holds the Planzone SHARE lock, excluding membership revocation.
-- The identity SHARE lock also excludes concurrent deactivation for this target.
CREATE FUNCTION pz8.member_available_for_resource(target_identity uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $function$
DECLARE selected_planzone uuid; target_active boolean;
BEGIN
    selected_planzone := NULLIF(current_setting('pz8.planzone_id', true), '')::uuid;
    IF NOT pz8.has_planzone_access(selected_planzone, true) THEN RETURN false; END IF;
    SELECT i.active INTO target_active FROM pz8.identities i
    JOIN pz8.memberships m ON m.identity_id = i.id
    WHERE i.id = target_identity AND m.planzone_id = selected_planzone AND m.active
    FOR SHARE OF i;
    RETURN target_active IS TRUE;
END
$function$;
REVOKE ALL ON FUNCTION pz8.member_available_for_resource(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION pz8.member_available_for_resource(uuid) TO pz8_runtime;

ALTER TABLE pz8.resources ENABLE ROW LEVEL SECURITY;
ALTER TABLE pz8.resources FORCE ROW LEVEL SECURITY;
CREATE POLICY resources_read ON pz8.resources FOR SELECT TO pz8_runtime
    USING (pz8.has_planzone_access(planzone_id, true));
CREATE POLICY resources_insert ON pz8.resources FOR INSERT TO pz8_runtime
    WITH CHECK (pz8.has_planzone_access(planzone_id, true) AND NOT deactivated AND version = 0
        AND (type <> 'HUMAN' OR (identity_id IS NOT NULL AND pz8.member_available_for_resource(identity_id))));
CREATE POLICY resources_update ON pz8.resources FOR UPDATE TO pz8_runtime
    USING (pz8.has_planzone_access(planzone_id, true))
    WITH CHECK (pz8.has_planzone_access(planzone_id, true));
GRANT SELECT, INSERT ON pz8.resources TO pz8_runtime;
GRANT UPDATE (name, version, updated_at) ON pz8.resources TO pz8_runtime;

ALTER TABLE pz8.resource_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE pz8.resource_operations FORCE ROW LEVEL SECURITY;
CREATE POLICY resource_operations_read ON pz8.resource_operations FOR SELECT TO pz8_runtime
    USING (pz8.has_planzone_access(planzone_id, true)
        AND actor_id = NULLIF(current_setting('pz8.identity_id', true), '')::uuid);
CREATE POLICY resource_operations_insert ON pz8.resource_operations FOR INSERT TO pz8_runtime
    WITH CHECK (pz8.has_planzone_access(planzone_id, true)
        AND actor_id = NULLIF(current_setting('pz8.identity_id', true), '')::uuid);
GRANT SELECT, INSERT ON pz8.resource_operations TO pz8_runtime;

ALTER TABLE pz8.resource_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE pz8.resource_audit FORCE ROW LEVEL SECURITY;
CREATE POLICY resource_audit_read ON pz8.resource_audit FOR SELECT TO pz8_runtime
    USING (pz8.has_planzone_access(planzone_id, true));
CREATE POLICY resource_audit_insert ON pz8.resource_audit FOR INSERT TO pz8_runtime
    WITH CHECK (pz8.has_planzone_access(planzone_id, true)
        AND actor_id = NULLIF(current_setting('pz8.identity_id', true), '')::uuid);
-- No UPDATE/DELETE policy or privilege: runtime history and receipts are append-only.
GRANT SELECT, INSERT ON pz8.resource_audit TO pz8_runtime;
RESET ROLE;
