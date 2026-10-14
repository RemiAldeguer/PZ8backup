package com.planzone.pz8.api;

import jakarta.servlet.http.HttpServletResponse;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpMethod;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.web.SecurityFilterChain;

@Configuration(proxyBeanMethods = false)
@ConditionalOnProperty(name = "pz8.access.enabled", havingValue = "false", matchIfMissing = true)
class ApiSecurityConfiguration {
  @Bean
  SecurityFilterChain apiSecurity(HttpSecurity http) throws Exception {
    return http.authorizeHttpRequests(
            requests ->
                requests
                    .requestMatchers(HttpMethod.GET, "/actuator/health/liveness")
                    .permitAll()
                    .anyRequest()
                    .denyAll())
        .exceptionHandling(
            errors ->
                errors.authenticationEntryPoint(
                    (request, response, exception) ->
                        response.sendError(HttpServletResponse.SC_UNAUTHORIZED)))
        .build();
  }
}
