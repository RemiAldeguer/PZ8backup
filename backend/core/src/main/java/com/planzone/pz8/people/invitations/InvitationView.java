package com.planzone.pz8.people.invitations;

import com.planzone.pz8.people.ResourceId;
import java.time.Instant;
import java.util.UUID;

public record InvitationView(
    UUID id,
    ResourceId resourceId,
    String email,
    String firstName,
    String lastName,
    UUID roleId,
    InvitationStatus status,
    Instant expiresAt,
    Instant createdAt) {}
