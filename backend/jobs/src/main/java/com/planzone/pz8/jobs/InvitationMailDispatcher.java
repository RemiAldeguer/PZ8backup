package com.planzone.pz8.jobs;

import com.planzone.pz8.people.invitations.InvitationMailQueue;
import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.mail.SimpleMailMessage;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.scheduling.annotation.Scheduled;

/** SMTP is an external effect: a lost acknowledgement can result in another delivery. */
final class InvitationMailDispatcher {
  private static final Logger LOG = LoggerFactory.getLogger(InvitationMailDispatcher.class);
  private final InvitationMailQueue queue;
  private final JavaMailSender sender;
  private final String mailFrom;

  InvitationMailDispatcher(InvitationMailQueue queue, JavaMailSender sender, String mailFrom) {
    this.queue = queue;
    this.sender = sender;
    this.mailFrom = mailFrom;
  }

  @Scheduled(fixedDelayString = "${pz8.invitation-mail.dispatch-delay-ms:2000}")
  void deliver() {
    List<InvitationMailQueue.Delivery> deliveries;
    try {
      deliveries = queue.claim(20);
    } catch (RuntimeException failure) {
      LOG.error("Invitation mail queue claim failed");
      return;
    }
    for (var delivery : deliveries) {
      try {
        sender.send(message(delivery));
      } catch (RuntimeException failure) {
        LOG.warn("Invitation delivery {} failed; durable retry requested", delivery.id());
        try {
          queue.markFailed(delivery.id(), delivery.leaseId());
        } catch (RuntimeException acknowledgementFailure) {
          LOG.error("Invitation delivery {} retry acknowledgement failed", delivery.id());
        }
        continue;
      }
      try {
        queue.markDelivered(delivery.id(), delivery.leaseId());
      } catch (RuntimeException failure) {
        LOG.error("Invitation delivery {} success acknowledgement failed", delivery.id());
      }
    }
  }

  private SimpleMailMessage message(InvitationMailQueue.Delivery delivery) {
    boolean french =
        delivery.language() != null
            && delivery.language().toLowerCase(java.util.Locale.ROOT).startsWith("fr");
    String name = delivery.firstName() + " " + delivery.lastName();
    String customMessage = delivery.message() == null ? "" : delivery.message();
    SimpleMailMessage mail = new SimpleMailMessage();
    mail.setFrom(mailFrom);
    mail.setTo(delivery.recipient());
    mail.setSubject(
        (french ? "Invitation à rejoindre " : "Invitation to join ") + delivery.planzoneName());
    mail.setText(
        (french ? "Bonjour " : "Hello ")
            + name
            + ",\n\n"
            + (french ? "Vous êtes invité à rejoindre " : "You are invited to join ")
            + delivery.planzoneName()
            + ".\n\n"
            + customMessage
            + "\n\n"
            + delivery.acceptanceUrl()
            + "\n\n"
            + (french
                ? "Connectez-vous avec l’adresse invitée pour accepter."
                : "Sign in with the invited email address to accept."));
    return mail;
  }
}
