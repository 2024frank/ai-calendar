import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { productionConfigIssues } from "../src/lib/config";

const valid = {
  NODE_ENV: "production",
  DATABASE_HOST: "db.internal",
  DATABASE_USERNAME: "app",
  DATABASE_PASSWORD: "secret",
  DATABASE_NAME: "calendar",
  PERPLEXITY_API_KEY: "pplx-key",
  AUTH_JWT_SECRET: "a".repeat(32),
  AGENT_INGEST_SECRET: "b".repeat(32),
  CRON_SECRET: "c".repeat(32),
  APP_URL: "https://calendar.example.com",
} satisfies NodeJS.ProcessEnv;

describe("productionConfigIssues", () => {
  it("accepts a complete production configuration", () => {
    assert.deepEqual(productionConfigIssues(valid), []);
  });

  it("reports missing values by name without exposing values", () => {
    const issues = productionConfigIssues({ ...valid, DATABASE_PASSWORD: "" });
    assert.deepEqual(issues, ["DATABASE_PASSWORD is missing"]);
  });

  it("rejects weak signing secrets and non-HTTPS production URLs", () => {
    const issues = productionConfigIssues({
      ...valid,
      AUTH_JWT_SECRET: "short",
      APP_URL: "http://calendar.example.com",
    });
    assert.ok(issues.includes("AUTH_JWT_SECRET must be at least 32 characters"));
    assert.ok(issues.includes("APP_URL must use HTTPS in production"));
  });
});
