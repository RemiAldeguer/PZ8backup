package com.planzone.pz8.people.invitations;

import com.planzone.pz8.people.ResourceId;
import com.planzone.pz8.planzones.PlanzoneId;

public record AcceptedInvitation(PlanzoneId planzoneId, ResourceId resourceId) {}
