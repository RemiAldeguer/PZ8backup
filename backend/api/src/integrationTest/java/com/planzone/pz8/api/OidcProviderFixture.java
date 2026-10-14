package com.planzone.pz8.api;

import com.nimbusds.jose.JOSEObjectType;
import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.JWSHeader;
import com.nimbusds.jose.crypto.RSASSASigner;
import com.nimbusds.jose.jwk.RSAKey;
import com.nimbusds.jose.util.JSONObjectUtils;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.net.InetSocketAddress;
import java.net.URI;
import java.net.URLDecoder;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.security.KeyPairGenerator;
import java.security.MessageDigest;
import java.security.interfaces.RSAPrivateKey;
import java.security.interfaces.RSAPublicKey;
import java.time.Instant;
import java.util.Base64;
import java.util.Date;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

/**
 * A real signed authorization-code provider. Only its own HTTP authorization page selects users.
 */
final class OidcProviderFixture implements AutoCloseable {
  enum TokenFault {
    NONE,
    NONCE,
    ISSUER,
    AUDIENCE
  }

  record Account(String subject, String email, boolean verified) {}

  private record Grant(
      Account account, String nonce, String challenge, String redirect, TokenFault fault) {}

  private final HttpServer server;
  private final RSAKey signingKey;
  private final Map<String, Account> accounts = new ConcurrentHashMap<>();
  private final Map<String, Grant> grants = new ConcurrentHashMap<>();
  private final Map<String, Account> accessTokens = new ConcurrentHashMap<>();
  private volatile Throwable failure;
  final URI issuer;

  OidcProviderFixture() throws Exception {
    var generator = KeyPairGenerator.getInstance("RSA");
    generator.initialize(2048);
    var pair = generator.generateKeyPair();
    signingKey =
        new RSAKey.Builder((RSAPublicKey) pair.getPublic())
            .privateKey((RSAPrivateKey) pair.getPrivate())
            .keyID("fixture-key")
            .build();
    server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
    issuer = URI.create("http://127.0.0.1:" + server.getAddress().getPort());
    server.createContext(
        "/",
        exchange -> {
          try {
            route(exchange);
          } catch (Throwable error) {
            failure = error;
            json(exchange, 500, Map.of("error", "provider_fixture_failed"));
          } finally {
            exchange.close();
          }
        });
    server.start();
  }

  Account account(String email, boolean verified) {
    var account = new Account(UUID.randomUUID().toString(), email, verified);
    accounts.put(account.subject(), account);
    return account;
  }

  URI authorizeAs(URI authorization, Account account, TokenFault fault) {
    return URI.create(
        authorization + "&fixture_account=" + account.subject() + "&fixture_fault=" + fault);
  }

  void assertHealthy() {
    if (failure != null) throw new AssertionError("OIDC provider fixture failed", failure);
  }

  private void route(HttpExchange exchange) throws Exception {
    switch (exchange.getRequestURI().getPath()) {
      case "/.well-known/openid-configuration" ->
          json(
              exchange,
              200,
              Map.ofEntries(
                  Map.entry("issuer", issuer.toString()),
                  Map.entry("authorization_endpoint", issuer.resolve("/authorize").toString()),
                  Map.entry("token_endpoint", issuer.resolve("/token").toString()),
                  Map.entry("userinfo_endpoint", issuer.resolve("/userinfo").toString()),
                  Map.entry("jwks_uri", issuer.resolve("/jwks").toString()),
                  Map.entry("response_types_supported", List.of("code")),
                  Map.entry("subject_types_supported", List.of("public")),
                  Map.entry("id_token_signing_alg_values_supported", List.of("RS256")),
                  Map.entry(
                      "token_endpoint_auth_methods_supported", List.of("client_secret_basic")),
                  Map.entry("code_challenge_methods_supported", List.of("S256"))));
      case "/jwks" ->
          json(exchange, 200, Map.of("keys", List.of(signingKey.toPublicJWK().toJSONObject())));
      case "/authorize" -> authorize(exchange);
      case "/token" -> token(exchange);
      case "/userinfo" -> userinfo(exchange);
      default -> json(exchange, 404, Map.of("error", "not_found"));
    }
  }

  private void authorize(HttpExchange exchange) throws IOException {
    Map<String, String> query = parameters(exchange.getRequestURI().getRawQuery());
    if (!"pz8".equals(query.get("client_id"))
        || !"code".equals(query.get("response_type"))
        || !"S256".equals(query.get("code_challenge_method"))
        || query.get("code_challenge") == null
        || query.get("nonce") == null
        || query.get("redirect_uri") == null
        || query.get("state") == null) {
      json(exchange, 400, Map.of("error", "invalid_authorization_request"));
      return;
    }
    String selectedAccount = query.get("fixture_account");
    if (selectedAccount == null) {
      chooseAccount(exchange, query);
      return;
    }
    Account account = accounts.get(selectedAccount);
    if (account == null) {
      json(exchange, 400, Map.of("error", "invalid_authorization_request"));
      return;
    }
    TokenFault fault;
    try {
      fault = TokenFault.valueOf(query.getOrDefault("fixture_fault", "NONE"));
    } catch (IllegalArgumentException invalidFault) {
      json(exchange, 400, Map.of("error", "invalid_authorization_request"));
      return;
    }
    String code = UUID.randomUUID().toString();
    grants.put(
        code,
        new Grant(
            account,
            query.get("nonce"),
            query.get("code_challenge"),
            query.get("redirect_uri"),
            fault));
    exchange
        .getResponseHeaders()
        .set(
            "Location",
            query.get("redirect_uri") + "?code=" + code + "&state=" + encode(query.get("state")));
    exchange.sendResponseHeaders(302, -1);
  }

  private void chooseAccount(HttpExchange exchange, Map<String, String> query) throws IOException {
    var page =
        new StringBuilder(
            "<!doctype html><html lang=\"fr\"><head><meta charset=\"UTF-8\">"
                + "<title>Fournisseur OIDC de recette</title></head><body>"
                + "<h1>Connexion de recette</h1><p>Choisissez un compte de test.</p>"
                + "<form method=\"GET\" action=\"/authorize\">");
    query.entrySet().stream()
        .sorted(Map.Entry.comparingByKey())
        .forEach(parameter -> hidden(page, parameter.getKey(), parameter.getValue()));
    if (!query.containsKey("fixture_fault")) hidden(page, "fixture_fault", "NONE");
    accounts.values().stream()
        .sorted(java.util.Comparator.comparing(Account::email).thenComparing(Account::subject))
        .forEach(
            account ->
                page.append("<p><button type=\"submit\" name=\"fixture_account\" value=\"")
                    .append(html(account.subject()))
                    .append("\">")
                    .append(html(account.email()))
                    .append("</button></p>"));
    page.append("</form></body></html>");
    byte[] bytes = page.toString().getBytes(StandardCharsets.UTF_8);
    exchange.getResponseHeaders().set("Content-Type", "text/html; charset=UTF-8");
    exchange.getResponseHeaders().set("Cache-Control", "no-store");
    exchange.getResponseHeaders().set("Referrer-Policy", "no-referrer");
    exchange
        .getResponseHeaders()
        .set("Content-Security-Policy", "default-src 'none'; base-uri 'none'");
    exchange.sendResponseHeaders(200, bytes.length);
    exchange.getResponseBody().write(bytes);
  }

  private static void hidden(StringBuilder page, String name, String value) {
    page.append("<input type=\"hidden\" name=\"")
        .append(html(name))
        .append("\" value=\"")
        .append(html(value))
        .append("\">");
  }

  private static String html(String value) {
    return value
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace("\"", "&quot;")
        .replace("'", "&#39;");
  }

  private void token(HttpExchange exchange) throws Exception {
    Map<String, String> form =
        parameters(new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
    Grant grant = grants.remove(form.get("code"));
    String authorization = exchange.getRequestHeaders().getFirst("Authorization");
    String expected =
        "Basic "
            + Base64.getEncoder().encodeToString("pz8:fixtures".getBytes(StandardCharsets.UTF_8));
    String verifier = form.get("code_verifier");
    String challenge =
        verifier == null
            ? ""
            : Base64.getUrlEncoder()
                .withoutPadding()
                .encodeToString(
                    MessageDigest.getInstance("SHA-256")
                        .digest(verifier.getBytes(StandardCharsets.US_ASCII)));
    if (grant == null
        || !expected.equals(authorization)
        || !"authorization_code".equals(form.get("grant_type"))
        || !grant.redirect().equals(form.get("redirect_uri"))
        || !grant.challenge().equals(challenge)) {
      json(exchange, 400, Map.of("error", "invalid_grant"));
      return;
    }
    Instant now = Instant.now();
    var claims =
        new JWTClaimsSet.Builder()
            .issuer(grant.fault() == TokenFault.ISSUER ? issuer + "/wrong" : issuer.toString())
            .subject(grant.account().subject())
            .audience(grant.fault() == TokenFault.AUDIENCE ? "other-client" : "pz8")
            .issueTime(Date.from(now))
            .expirationTime(Date.from(now.plusSeconds(300)))
            .claim("nonce", grant.fault() == TokenFault.NONCE ? "wrong-nonce" : grant.nonce())
            .claim("name", "OIDC " + grant.account().subject())
            .claim("email", grant.account().email())
            .claim("email_verified", grant.account().verified())
            .build();
    var jwt =
        new SignedJWT(
            new JWSHeader.Builder(JWSAlgorithm.RS256)
                .type(JOSEObjectType.JWT)
                .keyID(signingKey.getKeyID())
                .build(),
            claims);
    jwt.sign(new RSASSASigner(signingKey));
    String access = UUID.randomUUID().toString();
    accessTokens.put(access, grant.account());
    json(
        exchange,
        200,
        Map.of(
            "access_token",
            access,
            "token_type",
            "Bearer",
            "expires_in",
            300,
            "scope",
            "openid profile email",
            "id_token",
            jwt.serialize()));
  }

  private void userinfo(HttpExchange exchange) throws IOException {
    String header = exchange.getRequestHeaders().getFirst("Authorization");
    Account account =
        header != null && header.startsWith("Bearer ")
            ? accessTokens.get(header.substring(7))
            : null;
    if (account == null) {
      json(exchange, 401, Map.of("error", "invalid_token"));
      return;
    }
    json(
        exchange,
        200,
        Map.of(
            "sub",
            account.subject(),
            "name",
            "OIDC " + account.subject(),
            "email",
            account.email(),
            "email_verified",
            account.verified()));
  }

  static Map<String, String> parameters(String raw) {
    var result = new HashMap<String, String>();
    if (raw == null || raw.isEmpty()) return result;
    for (String part : raw.split("&")) {
      String[] pair = part.split("=", 2);
      result.put(
          URLDecoder.decode(pair[0], StandardCharsets.UTF_8),
          pair.length == 2 ? URLDecoder.decode(pair[1], StandardCharsets.UTF_8) : "");
    }
    return result;
  }

  static String encode(String value) {
    return URLEncoder.encode(value, StandardCharsets.UTF_8);
  }

  private static void json(HttpExchange exchange, int status, Map<String, ?> body)
      throws IOException {
    byte[] bytes = JSONObjectUtils.toJSONString(body).getBytes(StandardCharsets.UTF_8);
    exchange.getResponseHeaders().set("Content-Type", "application/json");
    exchange.sendResponseHeaders(status, bytes.length);
    exchange.getResponseBody().write(bytes);
  }

  @Override
  public void close() {
    server.stop(0);
  }
}
