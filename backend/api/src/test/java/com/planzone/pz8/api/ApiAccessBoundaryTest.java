package com.planzone.pz8.api;

import static org.assertj.core.api.Assertions.assertThat;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.context.SpringBootTest;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class ApiAccessBoundaryTest {
  @Value("${local.server.port}")
  private int port;

  private final HttpClient client =
      HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).build();

  @Test
  void livenessIsTheOnlyAnonymousRead() throws Exception {
    assertThat(get("/actuator/health/liveness").statusCode()).isEqualTo(200);
    for (String path :
        new String[] {
          "/actuator/health", "/actuator/health/readiness", "/actuator/env", "/api/v1/projects", "/"
        }) {
      HttpResponse<String> response = get(path);
      assertThat(response.statusCode()).as(path).isEqualTo(401);
      assertThat(response.body()).doesNotContain("password", "projects", "database");
    }
  }

  @Test
  void noLoginOrDevelopmentCredentialsGrantAccess() throws Exception {
    HttpRequest request =
        HttpRequest.newBuilder(uri("/api/v1/projects"))
            .timeout(Duration.ofSeconds(10))
            .header("Authorization", "Basic dXNlcjpwYXNzd29yZA==")
            .build();
    assertThat(client.send(request, HttpResponse.BodyHandlers.ofString()).statusCode())
        .isEqualTo(401);
    assertThat(get("/login").statusCode()).isEqualTo(401);
  }

  private HttpResponse<String> get(String path) throws Exception {
    return client.send(
        HttpRequest.newBuilder(uri(path)).timeout(Duration.ofSeconds(10)).build(),
        HttpResponse.BodyHandlers.ofString());
  }

  private URI uri(String path) {
    return URI.create("http://localhost:" + port + path);
  }
}
