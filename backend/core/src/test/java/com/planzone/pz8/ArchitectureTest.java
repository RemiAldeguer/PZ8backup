package com.planzone.pz8;

import static com.tngtech.archunit.lang.syntax.ArchRuleDefinition.noClasses;
import static com.tngtech.archunit.library.dependencies.SlicesRuleDefinition.slices;

import com.tngtech.archunit.core.importer.ImportOption;
import com.tngtech.archunit.junit.AnalyzeClasses;
import com.tngtech.archunit.junit.ArchTest;
import com.tngtech.archunit.lang.ArchRule;

@AnalyzeClasses(packages = "com.planzone.pz8", importOptions = ImportOption.DoNotIncludeTests.class)
class ArchitectureTest {
  @ArchTest
  static final ArchRule DOMAIN_HAS_NO_PERSISTENCE_OR_FRAMEWORK_DEPENDENCY =
      noClasses()
          .that()
          .resideInAnyPackage(
              "..identity..", "..planzones..", "..people..", "..access..", "..projects..")
          .should()
          .dependOnClassesThat()
          .resideInAnyPackage(
              "org.springframework..",
              "jakarta.persistence..",
              "java.sql..",
              "javax.sql..",
              "..platform..");

  @ArchTest
  static final ArchRule MODULES_HAVE_NO_DEPENDENCY_CYCLES =
      slices().matching("com.planzone.pz8.(*)..").should().beFreeOfCycles();
}
