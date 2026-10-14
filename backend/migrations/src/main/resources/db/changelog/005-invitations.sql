-- Pending profiles confer no access. Invitation secrets are hashes; mail secrets use AES-256-GCM.
-- A mail worker is provisioned separately; API logins never inherit its global delivery capability.
CREATE ROLE pz8_mailer NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
SET ROLE pz8_owner;
GRANT USAGE ON SCHEMA pz8 TO pz8_mailer;

CREATE TABLE pz8.invitations (
    id uuid PRIMARY KEY,
    planzone_id uuid NOT NULL,
    resource_id uuid NOT NULL,
    email varchar(254) NOT NULL,
    first_name varchar(256) NOT NULL,
    last_name varchar(256) NOT NULL,
    role_id uuid NOT NULL,
    status varchar(16) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'ACCEPTED', 'REVOKED')),
    token_hash varchar(64) NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
    expires_at timestamptz NOT NULL,
    accepted_identity uuid REFERENCES pz8.identities(id),
    accepted_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    created_by uuid NOT NULL REFERENCES pz8.identities(id),
    FOREIGN KEY (planzone_id, resource_id) REFERENCES pz8.resources(planzone_id, id),
    FOREIGN KEY (planzone_id, role_id) REFERENCES pz8.roles(planzone_id, id),
    CHECK ((status = 'ACCEPTED') = (accepted_identity IS NOT NULL AND accepted_at IS NOT NULL))
);
CREATE INDEX invitations_email_scope ON pz8.invitations(planzone_id, email) WHERE status = 'PENDING';
CREATE TABLE pz8.invitation_operations (
    planzone_id uuid NOT NULL,
    actor_id uuid NOT NULL REFERENCES pz8.identities(id),
    operation_id uuid NOT NULL,
    fingerprint varchar(64) NOT NULL CHECK (fingerprint ~ '^[0-9a-f]{64}$'),
    invitation_id uuid NOT NULL REFERENCES pz8.invitations(id),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (planzone_id, actor_id, operation_id)
);
CREATE TABLE pz8.invitation_mail_outbox (
    id uuid PRIMARY KEY,
    invitation_id uuid NOT NULL UNIQUE REFERENCES pz8.invitations(id),
    event_type text NOT NULL DEFAULT 'INVITATION_CREATED' CHECK (event_type = 'INVITATION_CREATED'),
    token_encrypted bytea,
    language varchar(16) NOT NULL,
    message varchar(5000) NOT NULL,
    attempts integer NOT NULL DEFAULT 0,
    available_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    lease_id uuid,
    lease_until timestamptz,
    delivered_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX invitation_mail_pending ON pz8.invitation_mail_outbox(available_at, created_at) WHERE delivered_at IS NULL;
-- FORCE RLS remains effective for runtime; only narrow owner functions can manipulate profiles.
CREATE POLICY resources_invitation_owner ON pz8.resources TO pz8_owner USING (true) WITH CHECK (true);
CREATE POLICY resource_audit_invitation_owner ON pz8.resource_audit FOR INSERT TO pz8_owner WITH CHECK (true);

CREATE FUNCTION pz8.require_invitation_manager() RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $function$
DECLARE selected uuid;
BEGIN
    selected := NULLIF(current_setting('pz8.planzone_id', true), '')::uuid;
    IF selected IS NULL OR NOT pz8.has_capability(selected, 'invitation:manage') THEN
        RAISE EXCEPTION 'Invitation management denied' USING ERRCODE = 'PZ007';
    END IF;
    RETURN selected;
END
$function$;

-- Tenant-scoped serialization protects PZ7's invite-only duplicate-name/email rule without
-- imposing name uniqueness on virtual/material resources. Replays never regenerate secrets.
CREATE FUNCTION pz8.prepare_invitation(operation uuid, request_fingerprint text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $function$
DECLARE selected uuid; actor uuid; receipt pz8.invitation_operations;
BEGIN
    selected := pz8.require_invitation_manager();
    actor := NULLIF(current_setting('pz8.identity_id', true), '')::uuid;
    PERFORM pg_advisory_xact_lock(hashtextextended('pz8.invitation.create:' || selected::text, 0));
    SELECT * INTO receipt FROM pz8.invitation_operations o
    WHERE o.planzone_id = selected AND o.actor_id = actor AND o.operation_id = operation;
    IF FOUND THEN
        IF receipt.fingerprint <> request_fingerprint THEN
            RAISE EXCEPTION 'Invitation operation conflict' USING ERRCODE = 'PZ008';
        END IF;
        RETURN receipt.invitation_id;
    END IF;
    RETURN NULL;
END
$function$;

CREATE FUNCTION pz8.create_invitation(operation uuid, request_fingerprint text,
    invitation uuid, resource uuid, invited_email text, given_name text, family_name text,
    selected_role uuid, invite_message text, invite_language text, expiration timestamptz,
    secret_hash text, encrypted_secret bytea) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $function$
DECLARE selected uuid; actor uuid; receipt uuid;
BEGIN
    selected := pz8.require_invitation_manager();
    actor := NULLIF(current_setting('pz8.identity_id', true), '')::uuid;
    receipt := pz8.prepare_invitation(operation, request_fingerprint);
    IF receipt IS NOT NULL THEN RETURN receipt; END IF;
    IF expiration <= clock_timestamp() OR expiration > clock_timestamp() + interval '365 days'
        OR char_length(invited_email) NOT BETWEEN 3 AND 254 OR invited_email <> btrim(invited_email)
        OR position('@' IN invited_email) < 2 OR char_length(btrim(given_name)) = 0
        OR char_length(btrim(family_name)) = 0 OR octet_length(encrypted_secret) < 28 THEN
        RAISE EXCEPTION 'Invalid invitation data' USING ERRCODE = '22023';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pz8.roles r WHERE r.planzone_id = selected AND r.id = selected_role) THEN
        RAISE EXCEPTION 'Invitation role unavailable' USING ERRCODE = 'PZ006';
    END IF;
    IF EXISTS (SELECT 1 FROM pz8.resources r WHERE r.planzone_id = selected AND r.name = given_name || ' ' || family_name) THEN
        RAISE EXCEPTION 'Invitation name duplicated' USING ERRCODE = 'PZ004';
    END IF;
    IF EXISTS (SELECT 1 FROM pz8.invitations i WHERE i.planzone_id = selected AND i.email = invited_email
        AND i.status = 'PENDING' AND i.expires_at > clock_timestamp()) THEN
        RAISE EXCEPTION 'Invitation email already pending' USING ERRCODE = 'PZ003';
    END IF;
    IF EXISTS (SELECT 1 FROM pz8.identity_profiles ip JOIN pz8.memberships m ON m.identity_id = ip.identity_id
        WHERE m.planzone_id = selected AND ip.email_verified AND btrim(ip.email) = invited_email) THEN
        -- Revoked memberships must not be resurrected through an invitation.
        RAISE EXCEPTION 'Account already belongs to this Planzone' USING ERRCODE = 'PZ005';
    END IF;
    INSERT INTO pz8.resources(planzone_id, id, name, type, role_id)
        VALUES (selected, resource, given_name || ' ' || family_name, 'HUMAN', selected_role);
    INSERT INTO pz8.invitations(id, planzone_id, resource_id, email, first_name, last_name,
        role_id, token_hash, expires_at, created_by)
        VALUES (invitation, selected, resource, invited_email, given_name, family_name,
            selected_role, secret_hash, expiration, actor);
    INSERT INTO pz8.invitation_operations(planzone_id, actor_id, operation_id, fingerprint, invitation_id)
        VALUES (selected, actor, operation, request_fingerprint, invitation);
    INSERT INTO pz8.invitation_mail_outbox(id, invitation_id, token_encrypted, language, message)
        VALUES (gen_random_uuid(), invitation, encrypted_secret, invite_language, invite_message);
    INSERT INTO pz8.resource_audit(id, planzone_id, resource_id, actor_id, operation_id, event_type, resource_type, resource_version)
        VALUES (gen_random_uuid(), selected, resource, actor, operation, 'CREATED', 'HUMAN', 0);
    RETURN invitation;
END
$function$;

CREATE FUNCTION pz8.list_invitations()
RETURNS TABLE(id uuid, resource_id uuid, email text, first_name text, last_name text, role_id uuid,
    status text, expires_at timestamptz, created_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $function$
DECLARE selected uuid;
BEGIN
    selected := pz8.require_invitation_manager();
    RETURN QUERY SELECT i.id, i.resource_id, i.email::text, i.first_name::text, i.last_name::text,
        r.role_id, CASE WHEN i.status = 'PENDING' AND i.expires_at <= clock_timestamp() THEN 'EXPIRED' ELSE i.status::text END,
        i.expires_at, i.created_at FROM pz8.invitations i
        JOIN pz8.resources r ON r.planzone_id = i.planzone_id AND r.id = i.resource_id
        WHERE i.planzone_id = selected ORDER BY i.created_at, i.id;
END
$function$;

CREATE FUNCTION pz8.revoke_invitation(invitation uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $function$
DECLARE selected uuid; result text;
BEGIN
    selected := pz8.require_invitation_manager();
    SELECT i.status INTO result FROM pz8.invitations i WHERE i.id = invitation AND i.planzone_id = selected FOR UPDATE;
    IF NOT FOUND OR result = 'ACCEPTED' THEN RETURN false; END IF;
    UPDATE pz8.invitations SET status = 'REVOKED' WHERE id = invitation AND status = 'PENDING';
    UPDATE pz8.invitation_mail_outbox SET token_encrypted = NULL WHERE invitation_id = invitation;
    RETURN true;
END
$function$;

CREATE FUNCTION pz8.preview_invitation(secret_hash text)
RETURNS TABLE(planzone_name text, email text, first_name text, last_name text, expires_at timestamptz)
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog
AS $function$
    SELECT p.name::text, i.email::text, i.first_name::text, i.last_name::text, i.expires_at
    FROM pz8.invitations i JOIN pz8.planzones p ON p.id = i.planzone_id
    JOIN pz8.planzone_security_state s ON s.planzone_id = i.planzone_id
    WHERE i.token_hash = secret_hash AND i.status = 'PENDING' AND i.expires_at > clock_timestamp() AND NOT s.suspended
$function$;

CREATE FUNCTION pz8.accept_invitation(authenticated_identity uuid, expected_security_version bigint, secret_hash text)
RETURNS TABLE(planzone_id uuid, resource_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $function$
DECLARE identity_active boolean; selected_security_version bigint; account_email text; verified boolean; selected uuid;
    suspended boolean; invite pz8.invitations; member pz8.memberships; role_name text; selected_role_id uuid;
BEGIN
    -- Same order as authorize_planzone: identity, authority, then invitation row.
    SELECT i.active, i.security_version INTO identity_active, selected_security_version
        FROM pz8.identities i WHERE i.id = authenticated_identity FOR UPDATE;
    IF identity_active IS DISTINCT FROM true OR expected_security_version IS NULL
        OR expected_security_version < 0 OR selected_security_version IS DISTINCT FROM expected_security_version THEN
        RAISE EXCEPTION 'Authenticated session has expired' USING ERRCODE = 'PZ011';
    END IF;
    SELECT ip.email, ip.email_verified INTO account_email, verified FROM pz8.identity_profiles ip
        WHERE ip.identity_id = authenticated_identity FOR SHARE;
    SELECT i.planzone_id INTO selected FROM pz8.invitations i WHERE i.token_hash = secret_hash;
    IF selected IS NULL THEN RAISE EXCEPTION 'Invitation unavailable' USING ERRCODE = 'PZ001'; END IF;
    SELECT s.suspended INTO suspended FROM pz8.planzone_security_state s WHERE s.planzone_id = selected FOR UPDATE;
    IF suspended IS DISTINCT FROM false THEN RAISE EXCEPTION 'Invitation unavailable' USING ERRCODE = 'PZ001'; END IF;
    SELECT * INTO invite FROM pz8.invitations i WHERE i.token_hash = secret_hash FOR UPDATE;
    IF invite.status = 'ACCEPTED' THEN
        IF invite.accepted_identity = authenticated_identity AND EXISTS (
            SELECT 1 FROM pz8.memberships m WHERE m.planzone_id = selected AND m.identity_id = authenticated_identity AND m.active)
            AND EXISTS (SELECT 1 FROM pz8.resources r WHERE r.planzone_id = selected AND r.id = invite.resource_id
                AND r.identity_id = authenticated_identity AND NOT r.deactivated) THEN
            RETURN QUERY SELECT selected, invite.resource_id;
            RETURN;
        END IF;
        RAISE EXCEPTION 'Invitation unavailable' USING ERRCODE = 'PZ001';
    END IF;
    IF invite.status <> 'PENDING' OR invite.expires_at <= clock_timestamp() THEN
        RAISE EXCEPTION 'Invitation unavailable' USING ERRCODE = 'PZ001';
    END IF;
    IF verified IS DISTINCT FROM true OR account_email IS NULL OR btrim(account_email) <> invite.email THEN
        RAISE EXCEPTION 'Invitation account mismatch' USING ERRCODE = 'PZ002';
    END IF;
    SELECT * INTO member FROM pz8.memberships m WHERE m.planzone_id = selected AND m.identity_id = authenticated_identity;
    IF FOUND THEN RAISE EXCEPTION 'Existing membership cannot be replaced' USING ERRCODE = 'PZ001'; END IF;
    SELECT r.role_id INTO selected_role_id FROM pz8.resources r WHERE r.planzone_id = selected AND r.id = invite.resource_id
        AND r.identity_id IS NULL AND NOT r.deactivated FOR UPDATE;
    IF selected_role_id IS NULL THEN
        RAISE EXCEPTION 'Invitation profile unavailable' USING ERRCODE = 'PZ001';
    END IF;
    SELECT r.coarse_role INTO role_name FROM pz8.roles r WHERE r.planzone_id = selected AND r.id = selected_role_id;
    IF role_name IS NULL THEN RAISE EXCEPTION 'Invitation role unavailable' USING ERRCODE = 'PZ001'; END IF;
    INSERT INTO pz8.memberships(planzone_id, identity_id, role, role_id) VALUES (selected, authenticated_identity, role_name, selected_role_id);
    UPDATE pz8.resources SET identity_id = authenticated_identity,
        version = version + 1, updated_at = clock_timestamp() WHERE pz8.resources.planzone_id = selected AND id = invite.resource_id;
    UPDATE pz8.invitations SET status = 'ACCEPTED', accepted_identity = authenticated_identity, accepted_at = clock_timestamp() WHERE id = invite.id;
    UPDATE pz8.invitation_mail_outbox SET token_encrypted = NULL WHERE invitation_id = invite.id;
    UPDATE pz8.planzone_security_state SET security_version = security_version + 1 WHERE pz8.planzone_security_state.planzone_id = selected;
    INSERT INTO pz8.resource_audit(id, planzone_id, resource_id, actor_id, operation_id, event_type, resource_type, resource_version)
        SELECT gen_random_uuid(), selected, invite.resource_id, authenticated_identity, invite.id, 'REGISTERED_MEMBER', 'HUMAN', r.version
        FROM pz8.resources r WHERE r.planzone_id = selected AND r.id = invite.resource_id;
    RETURN QUERY SELECT selected, invite.resource_id;
END
$function$;

-- The job receives only leased invitation mail; it has no access to identity/tenant catalogues.
CREATE FUNCTION pz8.claim_invitation_mail(batch_limit integer)
RETURNS TABLE(id uuid, lease_id uuid, invitation_id uuid, token_encrypted bytea, email text,
    language text, first_name text, last_name text, planzone_name text, message text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $function$
BEGIN
    IF batch_limit NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Invalid mail batch' USING ERRCODE = '22023'; END IF;
    RETURN QUERY WITH candidates AS (
        SELECT o.id FROM pz8.invitation_mail_outbox o JOIN pz8.invitations i ON i.id = o.invitation_id
        JOIN pz8.planzone_security_state s ON s.planzone_id = i.planzone_id
        WHERE o.delivered_at IS NULL AND o.token_encrypted IS NOT NULL AND o.available_at <= clock_timestamp()
            AND (o.lease_until IS NULL OR o.lease_until <= clock_timestamp())
            AND i.status = 'PENDING' AND i.expires_at > clock_timestamp() AND NOT s.suspended
        ORDER BY o.created_at, o.id FOR UPDATE OF o SKIP LOCKED LIMIT batch_limit
    ), claimed AS (
        UPDATE pz8.invitation_mail_outbox o SET lease_id = gen_random_uuid(), lease_until = clock_timestamp() + interval '5 minutes',
            attempts = attempts + 1 FROM candidates c WHERE o.id = c.id RETURNING o.*
    ) SELECT o.id, o.lease_id, o.invitation_id, o.token_encrypted, i.email::text, o.language::text,
        i.first_name::text, i.last_name::text, p.name::text, o.message::text FROM claimed o
        JOIN pz8.invitations i ON i.id = o.invitation_id JOIN pz8.planzones p ON p.id = i.planzone_id;
END
$function$;
CREATE FUNCTION pz8.finish_invitation_mail(delivery uuid, lease uuid, successful boolean) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $function$
DECLARE changed integer;
BEGIN
    UPDATE pz8.invitation_mail_outbox SET delivered_at = CASE WHEN successful THEN clock_timestamp() ELSE NULL END,
        token_encrypted = CASE WHEN successful THEN NULL ELSE token_encrypted END,
        available_at = CASE WHEN successful THEN available_at ELSE clock_timestamp() + interval '1 minute' END,
        lease_id = NULL, lease_until = NULL
    WHERE id = delivery AND lease_id = lease AND delivered_at IS NULL AND lease_until > clock_timestamp();
    GET DIAGNOSTICS changed = ROW_COUNT;
    RETURN changed > 0;
END
$function$;

REVOKE ALL ON FUNCTION pz8.require_invitation_manager(), pz8.prepare_invitation(uuid, text),
    pz8.create_invitation(uuid, text, uuid, uuid, text, text, text, uuid, text, text, timestamptz, text, bytea),
    pz8.list_invitations(), pz8.revoke_invitation(uuid), pz8.preview_invitation(text),
    pz8.accept_invitation(uuid, bigint, text), pz8.claim_invitation_mail(integer),
    pz8.finish_invitation_mail(uuid, uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION pz8.prepare_invitation(uuid, text),
    pz8.create_invitation(uuid, text, uuid, uuid, text, text, text, uuid, text, text, timestamptz, text, bytea),
    pz8.list_invitations(), pz8.revoke_invitation(uuid), pz8.preview_invitation(text),
    pz8.accept_invitation(uuid, bigint, text) TO pz8_runtime;
GRANT EXECUTE ON FUNCTION pz8.claim_invitation_mail(integer),
    pz8.finish_invitation_mail(uuid, uuid, boolean) TO pz8_mailer;
RESET ROLE;
