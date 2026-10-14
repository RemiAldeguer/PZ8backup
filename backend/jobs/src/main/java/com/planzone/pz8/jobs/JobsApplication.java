package com.planzone.pz8.jobs;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.WebApplicationType;
import org.springframework.boot.autoconfigure.SpringBootApplication;

@SpringBootApplication
public class JobsApplication {
  public static void main(String[] args) {
    SpringApplication application = new SpringApplication(JobsApplication.class);
    application.setWebApplicationType(WebApplicationType.NONE);
    application.run(args);
  }
}
