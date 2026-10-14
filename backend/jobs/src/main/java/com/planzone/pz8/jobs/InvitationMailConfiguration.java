package com.planzone.pz8.jobs;

import com.planzone.pz8.people.invitations.InvitationMailQueue;
import com.planzone.pz8.platform.jdbc.JdbcInvitationWork;
import com.planzone.pz8.platform.jdbc.PlanzoneUnitOfWork;
import com.zaxxer.hikari.HikariConfig;
import com.zaxxer.hikari.HikariDataSource;
import java.net.URI;
import java.util.Base64;
import javax.crypto.spec.SecretKeySpec;
import javax.sql.DataSource;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.env.Environment;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.mail.javamail.JavaMailSenderImpl;
import org.springframework.scheduling.annotation.EnableScheduling;

@Configuration(proxyBeanMethods = false)
@ConditionalOnProperty(name = "pz8.invitation-mail.enabled", havingValue = "true")
@EnableScheduling
class InvitationMailConfiguration {
  @Bean(destroyMethod = "close")
  HikariDataSource invitationDataSource(Environment env) {
    HikariConfig config = new HikariConfig();
    config.setJdbcUrl(required(env, "jdbc-url"));
    config.setUsername(required(env, "jdbc-username"));
    config.setPassword(required(env, "jdbc-password"));
    config.setMaximumPoolSize(2);
    config.setMinimumIdle(0);
    config.setConnectionTimeout(5000);
    return new HikariDataSource(config);
  }

  @Bean
  InvitationMailQueue invitationMailQueue(DataSource dataSource, Environment env) {
    byte[] key;
    try {
      key = Base64.getDecoder().decode(required(env, "invitation-encryption-key"));
    } catch (IllegalArgumentException failure) {
      throw new IllegalStateException("Invalid invitation encryption key");
    }
    if (key.length != 32) {
      throw new IllegalStateException("Invitation encryption key must contain 32 bytes");
    }
    URI frontend;
    try {
      frontend = URI.create(required(env, "frontend-url"));
    } catch (IllegalArgumentException failure) {
      throw new IllegalStateException("Invalid invitation frontend URL");
    }
    boolean local = env.getProperty("pz8.access.allow-local-http", Boolean.class, false);
    boolean loopback = isLoopback(frontend.getHost());
    if (frontend.getHost() == null
        || frontend.getUserInfo() != null
        || frontend.getRawQuery() != null
        || frontend.getRawFragment() != null
        || !("https".equals(frontend.getScheme())
            || local && loopback && "http".equals(frontend.getScheme()))) {
      throw new IllegalStateException(
          "Invitation frontend requires HTTPS; local HTTP requires explicit loopback configuration");
    }
    return new JdbcInvitationWork(
        new PlanzoneUnitOfWork(dataSource),
        dataSource,
        new SecretKeySpec(key, "AES"),
        frontend.resolve("/invitations/accept"));
  }

  @Bean
  JavaMailSender invitationMailSender(Environment env) {
    JavaMailSenderImpl sender = new JavaMailSenderImpl();
    sender.setHost(required(env, "smtp-host"));
    sender.setPort(env.getProperty("pz8.access.smtp-port", Integer.class, 587));
    sender.setDefaultEncoding("UTF-8");
    boolean startTls = env.getProperty("pz8.access.smtp-starttls", Boolean.class, true);
    if (!startTls && !isLoopback(sender.getHost())) {
      throw new IllegalStateException("SMTP STARTTLS is required outside loopback development");
    }
    String username = env.getProperty("pz8.access.smtp-username", "");
    String password = env.getProperty("pz8.access.smtp-password", "");
    if (username.isBlank() != password.isBlank()) {
      throw new IllegalStateException("SMTP username and password must be configured together");
    }
    if (!username.isBlank()) {
      sender.setUsername(username);
      sender.setPassword(password);
    }
    var properties = sender.getJavaMailProperties();
    properties.setProperty("mail.smtp.auth", Boolean.toString(!username.isBlank()));
    properties.setProperty("mail.smtp.starttls.enable", Boolean.toString(startTls));
    properties.setProperty("mail.smtp.starttls.required", Boolean.toString(startTls));
    properties.setProperty("mail.smtp.connectiontimeout", "5000");
    properties.setProperty("mail.smtp.timeout", "5000");
    properties.setProperty("mail.smtp.writetimeout", "5000");
    return sender;
  }

  @Bean
  InvitationMailDispatcher invitationMailDispatcher(
      InvitationMailQueue queue, JavaMailSender sender, Environment env) {
    return new InvitationMailDispatcher(queue, sender, required(env, "mail-from"));
  }

  private static boolean isLoopback(String host) {
    return "localhost".equals(host)
        || "127.0.0.1".equals(host)
        || "::1".equals(host)
        || "[::1]".equals(host);
  }

  private static String required(Environment env, String key) {
    String value = env.getProperty("pz8.access." + key);
    if (value == null || value.isBlank()) {
      throw new IllegalStateException("Missing pz8.access." + key);
    }
    return value;
  }
}
