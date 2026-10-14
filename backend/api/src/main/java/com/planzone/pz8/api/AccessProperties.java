package com.planzone.pz8.api;

import java.net.URI;
import java.util.Base64;
import javax.crypto.SecretKey;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.core.env.Environment;

record AccessProperties(
    String jdbcUrl,
    String jdbcUsername,
    String jdbcPassword,
    URI oidcIssuer,
    String clientId,
    String clientSecret,
    URI frontendUrl,
    URI publicApiUrl,
    boolean allowLocalHttp,
    SecretKey invitationKey,
    String mailFrom,
    int sessionSeconds) {
  static AccessProperties from(Environment env) {
    boolean local = env.getProperty("pz8.access.allow-local-http", Boolean.class, false);
    URI issuer = endpoint(required(env, "oidc-issuer"), local);
    URI frontend = endpoint(required(env, "frontend-url"), local);
    URI api = endpoint(required(env, "public-api-url"), local);
    byte[] key = Base64.getDecoder().decode(required(env, "invitation-encryption-key"));
    if (key.length != 32)
      throw new IllegalStateException("Invitation encryption key must contain 32 bytes");
    int seconds = env.getProperty("pz8.access.session-seconds", Integer.class, 1800);
    if (seconds < 60 || seconds > 86400)
      throw new IllegalStateException("Invalid session lifetime");
    return new AccessProperties(
        required(env, "jdbc-url"),
        required(env, "jdbc-username"),
        required(env, "jdbc-password"),
        issuer,
        required(env, "oidc-client-id"),
        required(env, "oidc-client-secret"),
        frontend,
        api,
        local,
        new SecretKeySpec(key, "AES"),
        required(env, "mail-from"),
        seconds);
  }

  static String required(Environment env, String key) {
    String value = env.getProperty("pz8.access." + key);
    if (value == null || value.isBlank())
      throw new IllegalStateException("Missing pz8.access." + key);
    return value;
  }

  private static URI endpoint(String value, boolean local) {
    URI uri = URI.create(value);
    boolean loopback =
        uri.getHost() != null
            && (uri.getHost().equals("localhost")
                || uri.getHost().equals("127.0.0.1")
                || uri.getHost().equals("[::1]"));
    if (uri.getHost() == null
        || uri.getUserInfo() != null
        || uri.getFragment() != null
        || (!"https".equals(uri.getScheme())
            && !(local && loopback && "http".equals(uri.getScheme()))))
      throw new IllegalStateException(
          "Access endpoints require HTTPS; local HTTP must use loopback explicitly");
    return uri;
  }

  @Override
  public String toString() {
    return "AccessProperties[configured]";
  }
}
