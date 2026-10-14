SET ROLE pz8_owner;

-- Private global login metadata; no membership is granted by an OIDC enrolment.
CREATE TABLE pz8.identity_profiles (
    identity_id uuid PRIMARY KEY REFERENCES pz8.identities(id),
    email varchar(254),
    email_verified boolean NOT NULL DEFAULT false,
    display_name varchar(256) NOT NULL,
    CHECK (NOT email_verified OR email IS NOT NULL)
);

CREATE FUNCTION pz8.resolve_oidc_identity(
    proposed_id uuid, issuer text, subject text, verified_email text, is_email_verified boolean, user_name text)
RETURNS TABLE(identity_id uuid, security_version bigint, email text, email_verified boolean, display_name text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $function$
DECLARE selected_id uuid; selected_active boolean; selected_version bigint;
BEGIN
    IF issuer IS NULL OR btrim(issuer) = '' OR char_length(issuer) > 2048
       OR subject IS NULL OR btrim(subject) = '' OR char_length(subject) > 255 THEN
        RAISE EXCEPTION 'Invalid verified OIDC identity' USING ERRCODE = '22023';
    END IF;
    INSERT INTO pz8.identities(id, oidc_issuer, oidc_subject)
    VALUES (proposed_id, issuer, subject)
    ON CONFLICT (oidc_issuer, oidc_subject) DO UPDATE
        SET security_version = pz8.identities.security_version
    RETURNING id, active, pz8.identities.security_version
        INTO selected_id, selected_active, selected_version;
    IF NOT selected_active THEN RETURN; END IF;
    INSERT INTO pz8.identity_profiles(identity_id, email, email_verified, display_name)
    VALUES (selected_id, verified_email, COALESCE(is_email_verified, false) AND verified_email IS NOT NULL, user_name)
    ON CONFLICT ON CONSTRAINT identity_profiles_pkey DO UPDATE SET
        email = EXCLUDED.email, email_verified = EXCLUDED.email_verified, display_name = EXCLUDED.display_name;
    RETURN QUERY SELECT selected_id, selected_version, p.email::text, p.email_verified, p.display_name::text
        FROM pz8.identity_profiles p WHERE p.identity_id = selected_id;
END
$function$;

CREATE FUNCTION pz8.current_identity_session(actor uuid, expected_version bigint)
RETURNS TABLE(identity_id uuid, security_version bigint, email text, email_verified boolean, display_name text)
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = pg_catalog
AS $function$
    SELECT i.id, i.security_version, p.email::text, p.email_verified,
        COALESCE(p.display_name, i.oidc_subject)::text
    FROM pz8.identities i LEFT JOIN pz8.identity_profiles p ON p.identity_id = i.id
    WHERE i.id = actor AND i.active AND i.security_version = expected_version
$function$;

-- The same identity SHARE lock is retained until the business transaction finishes.
CREATE FUNCTION pz8.check_identity_session(actor uuid, expected_version bigint) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $function$
DECLARE current_active boolean; current_version bigint;
BEGIN
    SELECT i.active, i.security_version INTO current_active, current_version
        FROM pz8.identities i WHERE i.id = actor FOR SHARE;
    RETURN COALESCE(current_active AND current_version = expected_version, false);
END
$function$;
REVOKE ALL ON FUNCTION pz8.check_identity_session(uuid,bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION pz8.check_identity_session(uuid,bigint) TO pz8_runtime;

-- The role owner remains subject to FORCE RLS. Narrow definer queries use an explicit owner policy.
CREATE POLICY planzones_owner_read ON pz8.planzones FOR SELECT TO pz8_owner USING (true);
CREATE POLICY resources_owner_read ON pz8.resources FOR SELECT TO pz8_owner USING (true);
CREATE FUNCTION pz8.accessible_planzones(actor uuid, expected_version bigint)
RETURNS TABLE(planzone_id uuid, name text, resource_id uuid)
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = pg_catalog
AS $function$
    SELECT p.id, p.name::text, r.id FROM pz8.memberships m
    JOIN pz8.identities i ON i.id = m.identity_id
    JOIN pz8.planzone_security_state s ON s.planzone_id = m.planzone_id
    JOIN pz8.planzones p ON p.id = m.planzone_id
    LEFT JOIN pz8.resources r ON r.planzone_id = m.planzone_id AND r.identity_id = m.identity_id
    WHERE m.identity_id = actor AND m.active AND i.active
        AND i.security_version = expected_version AND NOT s.suspended
    ORDER BY p.name COLLATE "C", p.id
$function$;
REVOKE ALL ON FUNCTION pz8.resolve_oidc_identity(uuid,text,text,text,boolean,text),
    pz8.current_identity_session(uuid,bigint), pz8.accessible_planzones(uuid,bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION pz8.resolve_oidc_identity(uuid,text,text,text,boolean,text),
    pz8.current_identity_session(uuid,bigint), pz8.accessible_planzones(uuid,bigint) TO pz8_runtime;

-- Spring Session catalogue is global, opaque-cookie based, and never exposed by the API.
CREATE TABLE pz8.http_sessions (
    primary_id char(36) PRIMARY KEY,
    session_id char(36) NOT NULL,
    creation_time bigint NOT NULL,
    last_access_time bigint NOT NULL,
    max_inactive_interval integer NOT NULL,
    expiry_time bigint NOT NULL,
    principal_name varchar(100)
);
CREATE UNIQUE INDEX http_sessions_session_id ON pz8.http_sessions(session_id);
CREATE INDEX http_sessions_expiry ON pz8.http_sessions(expiry_time);
CREATE INDEX http_sessions_principal ON pz8.http_sessions(principal_name);
CREATE TABLE pz8.http_sessions_attributes (
    session_primary_id char(36) NOT NULL REFERENCES pz8.http_sessions(primary_id) ON DELETE CASCADE,
    attribute_name varchar(200) NOT NULL,
    attribute_bytes bytea NOT NULL,
    PRIMARY KEY (session_primary_id, attribute_name)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON pz8.http_sessions, pz8.http_sessions_attributes TO pz8_runtime;
RESET ROLE;
