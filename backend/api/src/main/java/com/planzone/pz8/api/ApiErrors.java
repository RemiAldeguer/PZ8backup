package com.planzone.pz8.api;

import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;

final class ApiErrors {
  private ApiErrors() {}

  static void write(HttpServletResponse response, int status, String code, String message)
      throws IOException {
    response.setStatus(status);
    response.setContentType("application/json");
    response.setCharacterEncoding("UTF-8");
    response.setHeader("Cache-Control", "no-store");
    response
        .getWriter()
        .write(
            "{\"code\":\""
                + code
                + "\",\"message\":\""
                + message.replace("\\", "\\\\").replace("\"", "\\\"")
                + "\"}");
  }
}
