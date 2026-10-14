package com.planzone.pz8.jobs;

import static org.junit.jupiter.api.Assertions.*;

import com.planzone.pz8.people.invitations.InvitationMailQueue;
import jakarta.mail.Session;
import jakarta.mail.internet.MimeMessage;
import java.io.BufferedReader;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.OutputStreamWriter;
import java.io.PrintWriter;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Properties;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.Test;
import org.springframework.mail.javamail.JavaMailSenderImpl;

class InvitationMailDispatcherTest {
  @Test
  void deliversLocalizedInvitationAndAcknowledgesAcceptedMail() throws Exception {
    for (String language : List.of("fr", "en")) {
      try (RecordingSmtp smtp = new RecordingSmtp(false)) {
        Queue queue = new Queue(language);
        new InvitationMailDispatcher(queue, sender(smtp), "invitations@example.test").deliver();
        Received received = smtp.received.get(6, TimeUnit.SECONDS);
        MimeMessage mail =
            new MimeMessage(
                Session.getInstance(new Properties()),
                new ByteArrayInputStream(received.data().getBytes(StandardCharsets.UTF_8)));
        String text = (String) mail.getContent();
        assertEquals("RCPT TO:<invitee@example.test>", received.recipient());
        assertEquals("invitations@example.test", mail.getFrom()[0].toString());
        assertTrue(mail.getSubject().contains("Équipe"));
        assertTrue(text.contains(language.equals("fr") ? "Vous êtes invité" : "You are invited"));
        assertTrue(text.contains("Marie Dupont"));
        assertTrue(text.contains("Bienvenue dans notre équipe."));
        assertTrue(text.contains(queue.delivery.acceptanceUrl()));
        String paragraphs = text.replace("\r\n", "\n");
        assertTrue(paragraphs.contains("Marie Dupont,\n\n"));
        assertTrue(
            paragraphs.contains(
                "Bienvenue dans notre équipe.\n\n" + queue.delivery.acceptanceUrl() + "\n\n"));
        assertFalse(text.contains("\\n"));
        assertTrue(queue.delivered);
        assertFalse(queue.failed);
      }
    }
  }

  @Test
  void smtpRejectionLeavesDeliveryRetryableWithoutSuccessAcknowledgement() throws Exception {
    try (RecordingSmtp smtp = new RecordingSmtp(true)) {
      Queue queue = new Queue("en");
      new InvitationMailDispatcher(queue, sender(smtp), "invitations@example.test").deliver();
      smtp.received.get(6, TimeUnit.SECONDS);
      assertFalse(queue.delivered);
      assertTrue(queue.failed);
    }
  }

  @Test
  void uncertainSuccessAcknowledgementDoesNotRecordAnSmtpFailure() throws Exception {
    try (RecordingSmtp smtp = new RecordingSmtp(false)) {
      Queue queue = new Queue("en");
      queue.loseSuccessAcknowledgement = true;
      new InvitationMailDispatcher(queue, sender(smtp), "invitations@example.test").deliver();
      smtp.received.get(6, TimeUnit.SECONDS);
      assertFalse(queue.delivered);
      assertFalse(queue.failed);
    }
  }

  private static JavaMailSenderImpl sender(RecordingSmtp smtp) {
    JavaMailSenderImpl sender = new JavaMailSenderImpl();
    sender.setHost("127.0.0.1");
    sender.setPort(smtp.server.getLocalPort());
    sender.setDefaultEncoding("UTF-8");
    sender.getJavaMailProperties().setProperty("mail.smtp.connectiontimeout", "3000");
    sender.getJavaMailProperties().setProperty("mail.smtp.timeout", "3000");
    sender.getJavaMailProperties().setProperty("mail.smtp.writetimeout", "3000");
    return sender;
  }

  private static final class Queue implements InvitationMailQueue {
    private final Delivery delivery;
    private boolean claimed;
    private boolean delivered;
    private boolean failed;
    private boolean loseSuccessAcknowledgement;

    Queue(String language) {
      delivery =
          new Delivery(
              UUID.randomUUID(),
              UUID.randomUUID(),
              "invitee@example.test",
              language,
              "Marie",
              "Dupont",
              "Équipe",
              "Bienvenue dans notre équipe.",
              "https://app.example.test/invitations/accept?token=opaque-invitation-token");
    }

    public List<Delivery> claim(int limit) {
      if (claimed) return List.of();
      claimed = true;
      return List.of(delivery);
    }

    public void markDelivered(UUID id, UUID lease) {
      assertEquals(delivery.id(), id);
      assertEquals(delivery.leaseId(), lease);
      if (loseSuccessAcknowledgement) throw new IllegalStateException("Connection lost");
      delivered = true;
    }

    public void markFailed(UUID id, UUID lease) {
      assertEquals(delivery.id(), id);
      assertEquals(delivery.leaseId(), lease);
      failed = true;
    }
  }

  private record Received(String recipient, String data) {}

  /** A bounded SMTP peer records the actual network message, including MIME encoding. */
  private static final class RecordingSmtp implements AutoCloseable {
    private final ServerSocket server;
    private final Thread thread;
    private final CompletableFuture<Received> received = new CompletableFuture<>();
    private volatile Socket connection;

    RecordingSmtp(boolean reject) throws Exception {
      server = new ServerSocket(0, 1, InetAddress.getByName("127.0.0.1"));
      server.setSoTimeout(5000);
      thread = new Thread(() -> serve(reject), "invitation-smtp-test");
      thread.setDaemon(true);
      thread.start();
    }

    private void serve(boolean reject) {
      try (Socket socket = server.accept()) {
        connection = socket;
        socket.setSoTimeout(5000);
        BufferedReader input =
            new BufferedReader(
                new InputStreamReader(socket.getInputStream(), StandardCharsets.UTF_8));
        PrintWriter output =
            new PrintWriter(
                new OutputStreamWriter(socket.getOutputStream(), StandardCharsets.UTF_8), true);
        reply(output, "220 localhost test SMTP");
        String recipient = null;
        String command;
        while ((command = input.readLine()) != null) {
          if (command.startsWith("EHLO") || command.startsWith("HELO")) {
            reply(output, "250 localhost");
          } else if (command.startsWith("MAIL FROM:") || command.equals("RSET")) {
            reply(output, "250 OK");
          } else if (command.startsWith("RCPT TO:")) {
            recipient = command;
            reply(output, "250 OK");
          } else if (command.equals("DATA")) {
            reply(output, "354 End with dot");
            StringBuilder data = new StringBuilder();
            String line;
            while ((line = input.readLine()) != null && !line.equals(".")) {
              data.append(line.startsWith("..") ? line.substring(1) : line).append("\r\n");
            }
            received.complete(new Received(recipient, data.toString()));
            reply(output, reject ? "451 Temporary delivery failure" : "250 Queued");
          } else if (command.equals("QUIT")) {
            reply(output, "221 Goodbye");
            break;
          } else {
            throw new IllegalStateException("Unexpected SMTP command");
          }
        }
      } catch (Exception failure) {
        received.completeExceptionally(failure);
      }
    }

    private static void reply(PrintWriter output, String line) {
      output.print(line + "\r\n");
      output.flush();
    }

    @Override
    public void close() throws IOException {
      try {
        server.close();
      } finally {
        if (connection != null) connection.close();
      }
      try {
        thread.join(2000);
      } catch (InterruptedException failure) {
        Thread.currentThread().interrupt();
        throw new AssertionError("Interrupted while closing SMTP fixture", failure);
      }
      assertFalse(thread.isAlive(), "SMTP fixture must terminate");
    }
  }
}
