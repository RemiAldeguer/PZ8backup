package com.planzone.pz8.people.invitations;

import java.time.Instant;

public record InvitationPreview(
    String planzoneName,
    String email,
    String firstName,
    String lastName,
    InvitationStatus status,
    Instant expiresAt) {}
