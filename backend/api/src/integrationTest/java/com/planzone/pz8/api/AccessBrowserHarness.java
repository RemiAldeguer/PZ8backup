package com.planzone.pz8.api;

import com.nimbusds.jose.util.JSONObjectUtils;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.net.InetSocketAddress;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;

/** Standalone TEST-ONLY backend for browser acceptance of the actual Vite application. */
public final class AccessBrowserHarness {
  private AccessBrowserHarness() {}

  public static void main(String[] args) throws Exception {
    String destination = System.getenv("PZ8_BROWSER_FIXTURE_FILE");
    if (destination == null || destination.isBlank()) {
      throw new IllegalStateException("PZ8_BROWSER_FIXTURE_FILE must name the test manifest");
    }
    Path manifest = Path.of(destination).toAbsolutePath().normalize();
    Path pendingManifest = manifest.resolveSibling(manifest.getFileName() + ".pending");
    Files.createDirectories(manifest.getParent());
    var fixture = new HttpAccessFixture();
    var control = new AtomicReference<HttpServer>();
    var closed = new AtomicBoolean();
    Runnable cleanup =
        () -> {
          if (!closed.compareAndSet(false, true)) return;
          var server = control.get();
          if (server != null) server.stop(0);
          try {
            fixture.close();
          } finally {
            try {
              Files.deleteIfExists(manifest);
              Files.deleteIfExists(pendingManifest);
            } catch (IOException failure) {
              throw new UncheckedIOException("Could not remove browser fixture manifest", failure);
            }
          }
        };
    var shutdownHook = new Thread(cleanup, "pz8-browser-fixture-shutdown");
    Runtime.getRuntime().addShutdownHook(shutdownHook);
    try {
      var administrator = fixture.oidc.account("admin@example.test", true);
      var invitee = fixture.oidc.account("invitee@example.test", true);
      var administratorSession = new HttpAccessFixture.Browser(fixture.api);
      administratorSession.login(fixture.oidc, administrator, "/access");
      var tenant = fixture.tenant(fixture.identity(administrator), "Recette Java");
      var scopeState = ScopeBrowserSeed.install(fixture, tenant);

      var shutdownSignal = new CountDownLatch(1);
      var server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
      control.set(server);
      var invitationToken = new AtomicReference<String>();
      server.createContext(
          "/invitation",
          exchange -> {
            try {
              if (!"/invitation".equals(exchange.getRequestURI().getPath())) {
                json(exchange, 404, Map.of("code", "NOT_FOUND"));
              } else if (!"GET".equals(exchange.getRequestMethod())) {
                exchange.getResponseHeaders().set("Allow", "GET");
                json(exchange, 405, Map.of("code", "METHOD_NOT_ALLOWED"));
              } else {
                try {
                  String token = invitationToken.get();
                  if (token == null) {
                    token = fixture.invitationToken("invitee@example.test");
                    invitationToken.set(token);
                  }
                  json(exchange, 200, Map.of("token", token));
                } catch (Exception | AssertionError unavailable) {
                  json(exchange, 409, Map.of("code", "INVITATION_NOT_READY"));
                }
              }
            } finally {
              exchange.close();
            }
          });
      server.createContext(
          "/shutdown",
          exchange -> {
            boolean shutdown = false;
            try {
              if (!"/shutdown".equals(exchange.getRequestURI().getPath())) {
                json(exchange, 404, Map.of("code", "NOT_FOUND"));
              } else if (!"POST".equals(exchange.getRequestMethod())) {
                exchange.getResponseHeaders().set("Allow", "POST");
                json(exchange, 405, Map.of("code", "METHOD_NOT_ALLOWED"));
              } else {
                exchange.sendResponseHeaders(204, -1);
                shutdown = true;
              }
            } finally {
              exchange.close();
            }
            if (shutdown) shutdownSignal.countDown();
          });
      server.start();
      URI controlUrl = URI.create("http://127.0.0.1:" + server.getAddress().getPort());
      Map<String, Object> state = new LinkedHashMap<>();
      state.put("apiUrl", fixture.api.toString());
      state.put("issuer", fixture.oidc.issuer.toString());
      state.put("adminSubject", administrator.subject());
      state.put("inviteeSubject", invitee.subject());
      state.put("planzoneId", tenant.id().toString());
      state.put("adminRoleId", fixture.role(tenant, "pz_admin").toString());
      state.put("visitorRoleId", fixture.role(tenant, "pz_visitor").toString());
      state.put("controlUrl", controlUrl.toString());
      state.putAll(scopeState);
      Files.writeString(
          pendingManifest, JSONObjectUtils.toJSONString(state), StandardCharsets.UTF_8);
      try {
        Files.move(
            pendingManifest,
            manifest,
            StandardCopyOption.ATOMIC_MOVE,
            StandardCopyOption.REPLACE_EXISTING);
      } catch (java.nio.file.AtomicMoveNotSupportedException unsupported) {
        Files.move(pendingManifest, manifest, StandardCopyOption.REPLACE_EXISTING);
      }
      System.out.println("Browser acceptance fixture ready: " + manifest);
      shutdownSignal.await();
    } finally {
      try {
        cleanup.run();
      } finally {
        try {
          Runtime.getRuntime().removeShutdownHook(shutdownHook);
        } catch (IllegalStateException shuttingDown) {
          // The hook is already running during JVM shutdown.
        }
      }
    }
  }

  private static void json(HttpExchange exchange, int status, Map<String, ?> value)
      throws IOException {
    byte[] bytes = JSONObjectUtils.toJSONString(value).getBytes(StandardCharsets.UTF_8);
    exchange.getResponseHeaders().set("Content-Type", "application/json; charset=UTF-8");
    exchange.getResponseHeaders().set("Cache-Control", "no-store");
    exchange.getResponseHeaders().set("Referrer-Policy", "no-referrer");
    exchange.sendResponseHeaders(status, bytes.length);
    exchange.getResponseBody().write(bytes);
  }
}
