package com.planzone.pz8.api;

import com.planzone.pz8.identity.IdentitySessions;
import jakarta.servlet.http.HttpSession;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.*;
import org.springframework.http.HttpMethod;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.oauth2.client.registration.ClientRegistrationRepository;
import org.springframework.security.oauth2.client.web.*;
import org.springframework.security.web.*;
import org.springframework.security.web.access.intercept.AuthorizationFilter;
import org.springframework.security.web.savedrequest.NullRequestCache;

@Configuration(proxyBeanMethods = false)
@ConditionalOnProperty(name = "pz8.access.enabled", havingValue = "true")
class AccessSecurityConfiguration {
  @Bean
  SecurityFilterChain accessSecurity(
      HttpSecurity http,
      IdentitySessions identities,
      ClientRegistrationRepository clients,
      AccessProperties p)
      throws Exception {
    var resolver = new DefaultOAuth2AuthorizationRequestResolver(clients, "/api/v1/auth/authorize");
    resolver.setAuthorizationRequestCustomizer(OAuth2AuthorizationRequestCustomizers.withPkce());
    return http.authorizeHttpRequests(
            r ->
                r.requestMatchers(
                        HttpMethod.GET,
                        "/actuator/health/liveness",
                        "/api/v1/auth/login",
                        "/api/v1/auth/authorize/**",
                        "/api/v1/auth/callback/**",
                        "/api/v1/invitations/preview")
                    .permitAll()
                    .requestMatchers("/api/v1/**")
                    .authenticated()
                    .anyRequest()
                    .denyAll())
        .requestCache(r -> r.requestCache(new NullRequestCache()))
        .exceptionHandling(
            e ->
                e.authenticationEntryPoint(
                        (req, res, error) ->
                            ApiErrors.write(
                                res,
                                401,
                                "AUTHENTICATION_REQUIRED",
                                "Connectez-vous pour continuer."))
                    .accessDeniedHandler(
                        (req, res, error) ->
                            ApiErrors.write(
                                res,
                                403,
                                "ACCESS_DENIED",
                                "Vous ne disposez pas des droits nécessaires.")))
        .oauth2Login(
            o ->
                o.authorizationEndpoint(
                        a ->
                            a.baseUri("/api/v1/auth/authorize")
                                .authorizationRequestResolver(resolver))
                    .redirectionEndpoint(r -> r.baseUri("/api/v1/auth/callback/*"))
                    .userInfoEndpoint(
                        u -> u.oidcUserService(new VerifiedOidcUserService(identities)))
                    .successHandler(
                        (req, res, auth) -> {
                          HttpSession session = req.getSession(false);
                          String destination =
                              session == null
                                  ? null
                                  : (String) session.getAttribute(SessionController.RETURN_TO);
                          if (session != null) session.removeAttribute(SessionController.RETURN_TO);
                          res.setHeader("Cache-Control", "no-store");
                          res.sendRedirect(
                              p.frontendUrl()
                                  .resolve(destination == null ? "/access" : destination)
                                  .toString());
                        })
                    .failureHandler(
                        (req, res, error) ->
                            ApiErrors.write(
                                res,
                                401,
                                "AUTHENTICATION_FAILED",
                                "La connexion n’a pas pu être vérifiée.")))
        .logout(
            l ->
                l.logoutUrl("/api/v1/auth/logout")
                    .deleteCookies("PZ8SESSION")
                    .logoutSuccessHandler((req, res, auth) -> res.setStatus(204)))
        .addFilterBefore(new SessionIdentityFilter(identities), AuthorizationFilter.class)
        .build();
  }
}
