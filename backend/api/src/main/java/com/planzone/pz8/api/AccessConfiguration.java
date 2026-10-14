package com.planzone.pz8.api;

import com.planzone.pz8.access.AccessService;
import com.planzone.pz8.identity.IdentitySessions;
import com.planzone.pz8.people.ResourceService;
import com.planzone.pz8.people.invitations.*;
import com.planzone.pz8.platform.jdbc.*;
import com.zaxxer.hikari.HikariConfig;
import com.zaxxer.hikari.HikariDataSource;
import java.time.Clock;
import java.time.Duration;
import javax.sql.DataSource;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.*;
import org.springframework.core.env.Environment;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.security.oauth2.client.registration.*;
import org.springframework.security.oauth2.core.*;
import org.springframework.session.config.SessionRepositoryCustomizer;
import org.springframework.session.jdbc.*;
import org.springframework.session.jdbc.config.annotation.web.http.EnableJdbcHttpSession;
import org.springframework.session.web.http.*;
import org.springframework.transaction.PlatformTransactionManager;

@Configuration(proxyBeanMethods = false)
@ConditionalOnProperty(name = "pz8.access.enabled", havingValue = "true")
@EnableJdbcHttpSession(tableName = "pz8.http_sessions")
class AccessConfiguration {
  @Bean
  AccessProperties accessProperties(Environment env) {
    return AccessProperties.from(env);
  }

  @Bean(destroyMethod = "close")
  HikariDataSource dataSource(AccessProperties p) {
    HikariConfig c = new HikariConfig();
    c.setJdbcUrl(p.jdbcUrl());
    c.setUsername(p.jdbcUsername());
    c.setPassword(p.jdbcPassword());
    c.setMaximumPoolSize(10);
    c.setMinimumIdle(0);
    c.setConnectionTimeout(5000);
    return new HikariDataSource(c);
  }

  @Bean
  PlanzoneUnitOfWork planzoneUnitOfWork(DataSource ds) {
    return new PlanzoneUnitOfWork(ds);
  }

  @Bean
  PlatformTransactionManager transactionManager(DataSource ds) {
    return new DataSourceTransactionManager(ds);
  }

  @Bean
  IdentitySessions identitySessions(DataSource ds) {
    return new JdbcIdentitySessions(ds);
  }

  @Bean
  ResourceService resources(PlanzoneUnitOfWork work) {
    return new ResourceService(new JdbcPeopleWork(work));
  }

  @Bean
  AccessService accessService(PlanzoneUnitOfWork work) {
    return new JdbcAccessService(work);
  }

  @Bean
  com.planzone.pz8.projects.ScopedAccessService scopedAccessService(PlanzoneUnitOfWork work) {
    return new JdbcScopedAccessService(work);
  }

  @Bean
  JdbcInvitationWork invitationWork(PlanzoneUnitOfWork work, DataSource ds, AccessProperties p) {
    return new JdbcInvitationWork(
        work, ds, p.invitationKey(), p.frontendUrl().resolve("/invitations/accept"));
  }

  @Bean
  InvitationService invitations(JdbcInvitationWork work, Environment env) {
    return new InvitationService(
        work,
        Clock.systemUTC(),
        Duration.ofDays(env.getProperty("pz8.access.invitation-days", Long.class, 7L)));
  }

  @Bean
  ClientRegistrationRepository clientRegistrations(AccessProperties p) {
    ClientRegistration c =
        ClientRegistrations.fromIssuerLocation(p.oidcIssuer().toString())
            .registrationId("pz8")
            .clientId(p.clientId())
            .clientSecret(p.clientSecret())
            .clientAuthenticationMethod(ClientAuthenticationMethod.CLIENT_SECRET_BASIC)
            .authorizationGrantType(AuthorizationGrantType.AUTHORIZATION_CODE)
            .scope("openid", "profile", "email")
            .redirectUri(p.publicApiUrl().resolve("/api/v1/auth/callback/pz8").toString())
            .build();
    return new InMemoryClientRegistrationRepository(c);
  }

  @Bean
  CookieSerializer cookieSerializer(AccessProperties p) {
    DefaultCookieSerializer c = new DefaultCookieSerializer();
    c.setCookieName("PZ8SESSION");
    c.setCookiePath("/");
    c.setUseHttpOnlyCookie(true);
    c.setUseSecureCookie("https".equals(p.publicApiUrl().getScheme()));
    c.setSameSite("Lax");
    return c;
  }

  @Bean
  SessionRepositoryCustomizer<JdbcIndexedSessionRepository> sessionQueries(AccessProperties p) {
    return r -> {
      r.setDefaultMaxInactiveInterval(Duration.ofSeconds(p.sessionSeconds()));
      r.setCreateSessionAttributeQuery(
          "INSERT INTO %TABLE_NAME%_ATTRIBUTES (SESSION_PRIMARY_ID, ATTRIBUTE_NAME, ATTRIBUTE_BYTES) VALUES (?, ?, ?) ON CONFLICT (SESSION_PRIMARY_ID, ATTRIBUTE_NAME) DO UPDATE SET ATTRIBUTE_BYTES=EXCLUDED.ATTRIBUTE_BYTES");
    };
  }
}
