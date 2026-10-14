import org.gradle.api.artifacts.dsl.LockMode
import com.diffplug.gradle.spotless.SpotlessExtension

plugins {
    base
    id("org.springframework.boot") version "4.1.1" apply false
    id("com.diffplug.spotless") version "8.10.4" apply false
}

val javaFormatterVersion = "1.36.1"

allprojects {
    group = "com.planzone.pz8"
    version = "0.1.0-SNAPSHOT"
    repositories { mavenCentral() }
}

subprojects {
    apply(plugin = "java-library")
    apply(plugin = "com.diffplug.spotless")

    extensions.configure<SpotlessExtension> {
        java {
            target("src/**/*.java")
            googleJavaFormat(javaFormatterVersion)
            trimTrailingWhitespace()
            endWithNewline()
        }
    }

    // Resolve the formatter explicitly so its transitive dependencies have a lock and checksums.
    val javaFormatter = configurations.create("javaFormatter") {
        isCanBeConsumed = false
        isCanBeResolved = true
    }
    dependencies.add(javaFormatter.name, "com.google.googlejavaformat:google-java-format:$javaFormatterVersion")

    extensions.configure<JavaPluginExtension> {
        toolchain.languageVersion.set(JavaLanguageVersion.of(21))
    }

    dependencies {
        "implementation"(platform("org.springframework.boot:spring-boot-dependencies:4.1.1"))
        "implementation"(platform("org.springframework.modulith:spring-modulith-bom:2.1.1"))
        "testImplementation"("org.junit.jupiter:junit-jupiter")
        "testImplementation"("org.assertj:assertj-core")
        "testRuntimeOnly"("org.junit.platform:junit-platform-launcher")
    }

    dependencyLocking {
        lockAllConfigurations()
        lockMode.set(LockMode.STRICT)
        lockFile.set(rootProject.layout.projectDirectory.file("gradle/locks/${project.name}.lockfile"))
    }

    tasks.withType<JavaCompile>().configureEach {
        options.release.set(21)
        options.encoding = "UTF-8"
        options.compilerArgs.addAll(listOf("-Xlint:all", "-parameters"))
    }

    tasks.withType<Test>().configureEach {
        useJUnitPlatform()
        testLogging { events("failed", "skipped") }
    }

    tasks.register("resolveDependencies") {
        description = "Resolves every resolvable configuration for lock and checksum updates."
        doLast {
            configurations.filter { it.isCanBeResolved }.forEach { it.resolve() }
        }
    }
}

tasks.named("check") { dependsOn(subprojects.map { "${it.path}:check" }) }
