package com.planzone.pz8.identity;

public record IdentitySession(
    IdentityId id, long securityVersion, String email, boolean emailVerified, String displayName) {}
