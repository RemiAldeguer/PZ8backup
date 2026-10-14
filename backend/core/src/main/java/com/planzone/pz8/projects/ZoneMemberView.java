package com.planzone.pz8.projects;

import com.planzone.pz8.people.ResourceType;
import java.util.UUID;

public record ZoneMemberView(UUID resourceId, String name, ResourceType type) {}
