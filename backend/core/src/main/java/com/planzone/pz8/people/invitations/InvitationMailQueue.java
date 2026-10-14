package com.planzone.pz8.people.invitations;

import java.util.List;
import java.util.UUID;

public interface InvitationMailQueue {
  List<Delivery> claim(int limit);

  void markDelivered(UUID deliveryId, UUID leaseId);

  void markFailed(UUID deliveryId, UUID leaseId);

  record Delivery(
      UUID id,
      UUID leaseId,
      String recipient,
      String language,
      String firstName,
      String lastName,
      String planzoneName,
      String message,
      String acceptanceUrl) {
    @Override
    public String toString() {
      return "InvitationDelivery[id=" + id + "]";
    }
  }
}
