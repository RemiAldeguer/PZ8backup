plugins { id("org.springframework.boot") }

dependencies {
    implementation(project(":core"))
    implementation("org.springframework.boot:spring-boot-starter-webmvc")
    implementation("org.springframework.boot:spring-boot-starter-security")
    implementation("org.springframework.boot:spring-boot-starter-actuator")
    implementation("org.springframework.boot:spring-boot-starter-oauth2-client")
    implementation("org.springframework.session:spring-session-jdbc")
    implementation("com.zaxxer:HikariCP")
    runtimeOnly("org.postgresql:postgresql")
    testImplementation("org.springframework.boot:spring-boot-starter-test")
}

springBoot { mainClass.set("com.planzone.pz8.api.ApiApplication") }

val integrationTest by sourceSets.creating {
    compileClasspath += sourceSets.main.get().output
    runtimeClasspath += sourceSets.main.get().output
    resources.srcDir(rootProject.file("migrations/src/main/resources"))
}
configurations[integrationTest.implementationConfigurationName].extendsFrom(configurations.testImplementation.get())
configurations[integrationTest.runtimeOnlyConfigurationName].extendsFrom(configurations.testRuntimeOnly.get(), configurations.runtimeOnly.get())
dependencies {
    "integrationTestImplementation"("org.testcontainers:testcontainers-postgresql")
    "integrationTestImplementation"("org.liquibase:liquibase-core")
    "integrationTestImplementation"("org.postgresql:postgresql")
}
tasks.register<Test>("integrationTest") {
    description = "Runs real HTTP OIDC, session, CSRF and access flows against PostgreSQL."
    group = "verification"
    testClassesDirs = integrationTest.output.classesDirs
    classpath = integrationTest.runtimeClasspath
    shouldRunAfter(tasks.test)
}

tasks.register<JavaExec>("browserAcceptanceFixture") {
    description = "Starts the test-only PostgreSQL/OIDC/API fixture for real browser acceptance."
    group = "verification"
    dependsOn(tasks.named(integrationTest.classesTaskName))
    classpath = integrationTest.runtimeClasspath
    mainClass.set("com.planzone.pz8.api.AccessBrowserHarness")
    workingDir(rootProject.projectDir)
    javaLauncher.set(javaToolchains.launcherFor {
        languageVersion.set(JavaLanguageVersion.of(21))
    })
}
