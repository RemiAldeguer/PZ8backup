package com.planzone.pz8.api;

import static org.assertj.core.api.Assertions.assertThat;

import java.net.URI;
import javax.crypto.spec.SecretKeySpec;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.session.web.http.CookieSerializer;

class SessionCookieBoundaryTest {
  @Test
  void publicHttpsCookieRemainsSecureWithLocalOidcDevelopmentEnabled() {
    var p =
        new AccessProperties(
            "jdbc:postgresql://localhost/test",
            "unused",
            "unused",
            URI.create("http://127.0.0.1:8180/realms/test"),
            "pz8",
            "unused",
            URI.create("https://app.example.test"),
            URI.create("https://app.example.test"),
            true,
            new SecretKeySpec(new byte[32], "AES"),
            "noreply@example.test",
            1800);
    var request = new MockHttpServletRequest();
    request.setServerName("app.example.test");
    var response = new MockHttpServletResponse();
    new AccessConfiguration()
        .cookieSerializer(p)
        .writeCookieValue(new CookieSerializer.CookieValue(request, response, "opaque-session"));
    assertThat(response.getHeader("Set-Cookie")).contains("Secure", "HttpOnly", "SameSite=Lax");
  }
}
