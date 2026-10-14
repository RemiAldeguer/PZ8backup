plugins { `java-library` }

dependencies {
    implementation("org.springframework:spring-jdbc")
    implementation("org.springframework:spring-tx")
    implementation("org.springframework.security:spring-security-core")
    implementation("org.springframework.modulith:spring-modulith-api")
    runtimeOnly("org.postgresql:postgresql")
    testImplementation("org.springframework.modulith:spring-modulith-starter-test")
    testImplementation("com.tngtech.archunit:archunit-junit5:1.4.1")
}

val integrationTest by sourceSets.creating {
    compileClasspath += sourceSets.main.get().output
    runtimeClasspath += sourceSets.main.get().output
    resources.srcDir(rootProject.file("migrations/src/main/resources"))
}

configurations[integrationTest.implementationConfigurationName]
    .extendsFrom(configurations.testImplementation.get())
configurations[integrationTest.runtimeOnlyConfigurationName]
    .extendsFrom(configurations.testRuntimeOnly.get(), configurations.runtimeOnly.get())

dependencies {
    "integrationTestImplementation"("org.testcontainers:testcontainers-postgresql")
    "integrationTestImplementation"("org.testcontainers:testcontainers-junit-jupiter")
    "integrationTestImplementation"("org.liquibase:liquibase-core")
    "integrationTestImplementation"("com.zaxxer:HikariCP")
    "integrationTestImplementation"("org.postgresql:postgresql")
}

tasks.register<Test>("integrationTest") {
    description = "Runs PostgreSQL transaction and tenant isolation tests; requires Docker or PZ8_TEST_JDBC_URL."
    group = "verification"
    testClassesDirs = integrationTest.output.classesDirs
    classpath = integrationTest.runtimeClasspath
    shouldRunAfter(tasks.test)
}
