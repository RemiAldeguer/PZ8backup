-- Initial installation needs a role allowed to create roles and SET ROLE pz8_owner.
-- Login credentials are provisioned separately; runtime never inherits owner/migrator.
CREATE ROLE pz8_owner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE pz8_migrator NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE pz8_runtime NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
GRANT pz8_owner TO pz8_migrator;
CREATE SCHEMA pz8 AUTHORIZATION pz8_owner;
REVOKE ALL ON SCHEMA pz8 FROM PUBLIC;
GRANT USAGE ON SCHEMA pz8 TO pz8_runtime;
SET ROLE pz8_owner;
ALTER DEFAULT PRIVILEGES IN SCHEMA pz8 REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

CREATE TABLE pz8.clients (
    id uuid PRIMARY KEY,
    planzone_id uuid NOT NULL UNIQUE,
    name varchar(120) NOT NULL CHECK (char_length(btrim(name)) > 0)
);
CREATE TABLE pz8.planzones (
    id uuid PRIMARY KEY,
    client_id uuid NOT NULL UNIQUE REFERENCES pz8.clients(id) DEFERRABLE INITIALLY DEFERRED,
    name varchar(120) NOT NULL CHECK (char_length(btrim(name)) > 0),
    UNIQUE (id, client_id)
);
-- Both references are deferred so client and its sole Planzone are created atomically.
ALTER TABLE pz8.clients ADD CONSTRAINT client_single_planzone
    FOREIGN KEY (planzone_id, id) REFERENCES pz8.planzones(id, client_id)
    DEFERRABLE INITIALLY DEFERRED;

-- Authority catalogue is private: runtime has no direct SELECT or mutation privileges.
-- Definer functions below expose only exact OIDC lookup and exact scoped authorization.
CREATE TABLE pz8.identities (
    id uuid PRIMARY KEY,
    oidc_issuer varchar(2048) NOT NULL,
    oidc_subject varchar(255) NOT NULL,
    active boolean NOT NULL DEFAULT true,
    security_version bigint NOT NULL DEFAULT 0 CHECK (security_version >= 0),
    UNIQUE (oidc_issuer, oidc_subject)
);
CREATE TABLE pz8.planzone_security_state (
    planzone_id uuid PRIMARY KEY REFERENCES pz8.planzones(id),
    suspended boolean NOT NULL DEFAULT false,
    security_version bigint NOT NULL DEFAULT 0 CHECK (security_version >= 0)
);
CREATE TABLE pz8.memberships (
    planzone_id uuid NOT NULL REFERENCES pz8.planzone_security_state(planzone_id),
    identity_id uuid NOT NULL REFERENCES pz8.identities(id),
    role varchar(32) NOT NULL CHECK (role IN ('administrator', 'project_creator', 'user', 'visitor')),
    active boolean NOT NULL DEFAULT true,
    PRIMARY KEY (planzone_id, identity_id)
);
CREATE TABLE pz8.zones (
    id uuid NOT NULL,
    planzone_id uuid NOT NULL REFERENCES pz8.planzones(id),
    name varchar(120) NOT NULL CHECK (char_length(btrim(name)) > 0),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (planzone_id, id)
);
CREATE INDEX zones_name_page ON pz8.zones(planzone_id, name COLLATE "C", id);

CREATE FUNCTION pz8.identity_for_oidc(issuer text, subject text) RETURNS uuid
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = pg_catalog
AS $function$
    SELECT i.id FROM pz8.identities i
    WHERE i.oidc_issuer = issuer AND i.oidc_subject = subject AND i.active
$function$;

-- Lock order: identity, then Planzone. FOR SHARE conflicts with revocation UPDATE.
-- Runtime only receives the selected membership's role; no tenant catalogue is exposed.
CREATE FUNCTION pz8.authorize_planzone(actor uuid, selected_planzone uuid, change_authority boolean)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $function$
DECLARE identity_active boolean; planzone_suspended boolean; member_role text;
BEGIN
    SELECT i.active INTO identity_active FROM pz8.identities i WHERE i.id = actor FOR SHARE;
    IF identity_active IS DISTINCT FROM true THEN RETURN NULL; END IF;
    IF change_authority THEN
        SELECT s.suspended INTO planzone_suspended FROM pz8.planzone_security_state s
        WHERE s.planzone_id = selected_planzone FOR UPDATE;
    ELSE
        SELECT s.suspended INTO planzone_suspended FROM pz8.planzone_security_state s
        WHERE s.planzone_id = selected_planzone FOR SHARE;
    END IF;
    IF planzone_suspended IS DISTINCT FROM false THEN RETURN NULL; END IF;
    SELECT m.role INTO member_role FROM pz8.memberships m
    WHERE m.planzone_id = selected_planzone AND m.identity_id = actor AND m.active;
    RETURN member_role;
END
$function$;

CREATE FUNCTION pz8.has_planzone_access(selected_planzone uuid, requires_administrator boolean)
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE SET search_path = pg_catalog
AS $function$
    SELECT COALESCE(
        selected_planzone = NULLIF(current_setting('pz8.planzone_id', true), '')::uuid
        AND EXISTS (
            SELECT 1 FROM pz8.memberships m
            JOIN pz8.identities i ON i.id = m.identity_id
            JOIN pz8.planzone_security_state s ON s.planzone_id = m.planzone_id
            WHERE m.planzone_id = selected_planzone
              AND m.identity_id = NULLIF(current_setting('pz8.identity_id', true), '')::uuid
              AND m.active AND i.active AND NOT s.suspended
              AND (NOT requires_administrator OR m.role = 'administrator')
        ), false)
$function$;

-- Reacquires UPDATE immediately; callers must use executeAuthorityChange, not upgrade SHARE.
CREATE FUNCTION pz8.revoke_membership(target_identity uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $function$
DECLARE selected_planzone uuid; actor uuid; member_role text; affected integer;
BEGIN
    selected_planzone := NULLIF(current_setting('pz8.planzone_id', true), '')::uuid;
    actor := NULLIF(current_setting('pz8.identity_id', true), '')::uuid;
    IF selected_planzone IS NULL OR actor IS NULL THEN RETURN false; END IF;
    member_role := pz8.authorize_planzone(actor, selected_planzone, true);
    IF member_role IS DISTINCT FROM 'administrator' THEN RETURN false; END IF;
    UPDATE pz8.memberships SET active = false
    WHERE planzone_id = selected_planzone AND identity_id = target_identity AND active;
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected > 0 THEN
        UPDATE pz8.planzone_security_state SET security_version = security_version + 1
        WHERE planzone_id = selected_planzone;
    END IF;
    RETURN affected > 0;
END
$function$;

ALTER TABLE pz8.clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE pz8.clients FORCE ROW LEVEL SECURITY;
ALTER TABLE pz8.planzones ENABLE ROW LEVEL SECURITY;
ALTER TABLE pz8.planzones FORCE ROW LEVEL SECURITY;
ALTER TABLE pz8.zones ENABLE ROW LEVEL SECURITY;
ALTER TABLE pz8.zones FORCE ROW LEVEL SECURITY;
CREATE POLICY clients_read ON pz8.clients FOR SELECT TO pz8_runtime
    USING (pz8.has_planzone_access(planzone_id, false));
CREATE POLICY planzones_read ON pz8.planzones FOR SELECT TO pz8_runtime
    USING (pz8.has_planzone_access(id, false));
CREATE POLICY zones_read ON pz8.zones FOR SELECT TO pz8_runtime
    USING (pz8.has_planzone_access(planzone_id, false));
CREATE POLICY zones_insert ON pz8.zones FOR INSERT TO pz8_runtime
    WITH CHECK (pz8.has_planzone_access(planzone_id, true));
CREATE POLICY zones_update ON pz8.zones FOR UPDATE TO pz8_runtime
    USING (pz8.has_planzone_access(planzone_id, true))
    WITH CHECK (pz8.has_planzone_access(planzone_id, true));
CREATE POLICY zones_delete ON pz8.zones FOR DELETE TO pz8_runtime
    USING (pz8.has_planzone_access(planzone_id, true));
GRANT SELECT ON pz8.clients, pz8.planzones TO pz8_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON pz8.zones TO pz8_runtime;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA pz8 FROM PUBLIC;
GRANT EXECUTE ON FUNCTION pz8.identity_for_oidc(text, text),
    pz8.authorize_planzone(uuid, uuid, boolean), pz8.has_planzone_access(uuid, boolean),
    pz8.revoke_membership(uuid) TO pz8_runtime;
RESET ROLE;
