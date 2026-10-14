plugins { id("org.springframework.boot") }

dependencies {
    implementation("org.springframework.boot:spring-boot-starter-mail")
    implementation("com.zaxxer:HikariCP")
    runtimeOnly("org.postgresql:postgresql")
    implementation(project(":core"))
    implementation("org.springframework.boot:spring-boot-starter")
}

springBoot { mainClass.set("com.planzone.pz8.jobs.JobsApplication") }
