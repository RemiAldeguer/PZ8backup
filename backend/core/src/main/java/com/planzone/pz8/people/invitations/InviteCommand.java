package com.planzone.pz8.people.invitations;

import java.util.Objects;
import java.util.UUID;

public record InviteCommand(
    UUID operationId,
    String email,
    String firstName,
    String lastName,
    UUID roleId,
    String message,
    String language) {
  public InviteCommand {
    Objects.requireNonNull(operationId, "operationId");
    Objects.requireNonNull(roleId, "roleId");
    email = normalizeEmail(email);
    firstName = name(firstName);
    lastName = name(lastName);
    if ((firstName + " " + lastName).length() > 256) {
      throw new IllegalArgumentException("Combined name must contain at most 256 characters");
    }
    message = message == null ? "" : message;
    if (message.length() > 5000 || message.indexOf('\0') >= 0) {
      throw new IllegalArgumentException("Invitation message is too long");
    }
    language = language == null || language.isBlank() ? "fr" : language.trim();
    if (!language.matches("[a-zA-Z]{2,3}([_-][a-zA-Z]{2})?")) {
      throw new IllegalArgumentException("Invalid invitation language");
    }
  }

  public static String normalizeEmail(String email) {
    Objects.requireNonNull(email, "email");
    String value = email.trim();
    int at = value.lastIndexOf('@');
    if (value.length() > 254
        || at <= 0
        || at != value.indexOf('@')
        || at == value.length() - 1
        || value.chars().anyMatch(c -> Character.isWhitespace(c) || Character.isISOControl(c))) {
      throw new IllegalArgumentException("Invalid email address");
    }
    return value;
  }

  private static String name(String input) {
    Objects.requireNonNull(input, "name");
    String value = input.trim();
    if (value.isEmpty() || value.length() > 256 || value.indexOf('\0') >= 0) {
      throw new IllegalArgumentException("Names must contain 1 to 256 characters");
    }
    return value;
  }
}
