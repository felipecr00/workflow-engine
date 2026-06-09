import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { Kysely, PostgresDialect } from "kysely";
import { runMigrations } from "../src/engine/db/migrator";
import type { Database } from "../src/engine/db/types";
import {
  deployForm,
  findFormByKeyAndVersion,
  findLatestFormByKey,
  listForms,
} from "../src/engine/repository/forms";
import { resetDatabase, TEST_DATABASE_URL } from "./helpers/db";

const SCHEMA_V1 = {
  type: "default",
  components: [
    { key: "approved", type: "checkbox", label: "Approve?" },
    { key: "comment", type: "textfield", label: "Comment" },
  ],
};

const SCHEMA_V2 = {
  type: "default",
  components: [
    { key: "approved", type: "checkbox", label: "Approve?" },
    { key: "comment", type: "textfield", label: "Comment" },
    { key: "amount", type: "number", label: "Amount" },
  ],
};

describe("forms repository", () => {
  let pool: Pool;
  let db: Kysely<Database>;

  beforeAll(async () => {
    await resetDatabase();
    pool = new Pool({ connectionString: TEST_DATABASE_URL });
    await runMigrations(pool);
    db = new Kysely<Database>({ dialect: new PostgresDialect({ pool }) });
  });

  beforeEach(async () => {
    await db.deleteFrom("forms").execute();
  });

  afterAll(async () => {
    // db.destroy() returns the underlying pool, so we don't end it again.
    await db.destroy();
  });

  it("inserts a new form at version 1", async () => {
    const row = await deployForm(db, { key: "approval", schema: SCHEMA_V1 });
    expect(row.key).toBe("approval");
    expect(row.version).toBe(1);
    expect(row.format).toBe("form-js");
    expect(row.schema).toEqual(SCHEMA_V1);
  });

  it("returns the same row when the schema is deeply equal (idempotent)", async () => {
    const first = await deployForm(db, { key: "approval", schema: SCHEMA_V1 });
    const second = await deployForm(db, {
      key: "approval",
      // Different key order; deep equality should still hold.
      schema: {
        components: SCHEMA_V1.components,
        type: SCHEMA_V1.type,
      },
    });
    expect(second.id).toBe(first.id);
    expect(second.version).toBe(1);

    const all = await db.selectFrom("forms").selectAll().execute();
    expect(all).toHaveLength(1);
  });

  it("bumps the version when the schema changes", async () => {
    const v1 = await deployForm(db, { key: "approval", schema: SCHEMA_V1 });
    const v2 = await deployForm(db, { key: "approval", schema: SCHEMA_V2 });
    expect(v1.version).toBe(1);
    expect(v2.version).toBe(2);
    expect(v2.id).not.toBe(v1.id);
  });

  it("findLatestFormByKey returns the highest version", async () => {
    await deployForm(db, { key: "approval", schema: SCHEMA_V1 });
    await deployForm(db, { key: "approval", schema: SCHEMA_V2 });
    const latest = await findLatestFormByKey(db, "approval");
    expect(latest?.version).toBe(2);
    expect(latest?.schema).toEqual(SCHEMA_V2);
  });

  it("findLatestFormByKey returns null for unknown keys", async () => {
    const none = await findLatestFormByKey(db, "does-not-exist");
    expect(none).toBeNull();
  });

  it("findFormByKeyAndVersion fetches a specific version", async () => {
    await deployForm(db, { key: "approval", schema: SCHEMA_V1 });
    await deployForm(db, { key: "approval", schema: SCHEMA_V2 });
    const v1 = await findFormByKeyAndVersion(db, "approval", 1);
    expect(v1?.schema).toEqual(SCHEMA_V1);
    const v2 = await findFormByKeyAndVersion(db, "approval", 2);
    expect(v2?.schema).toEqual(SCHEMA_V2);
    const missing = await findFormByKeyAndVersion(db, "approval", 99);
    expect(missing).toBeNull();
  });

  it("listForms returns only the latest version per key, sorted by key", async () => {
    await deployForm(db, { key: "approval", schema: SCHEMA_V1 });
    await deployForm(db, { key: "approval", schema: SCHEMA_V2 });
    await deployForm(db, { key: "intake", schema: SCHEMA_V1 });

    const list = await listForms(db);
    expect(list.map((f) => ({ key: f.key, version: f.version }))).toEqual([
      { key: "approval", version: 2 },
      { key: "intake", version: 1 },
    ]);
  });

  it("persists format and ui_schema", async () => {
    const ui = { layout: { columns: 2 } };
    const row = await deployForm(db, {
      key: "approval",
      schema: SCHEMA_V1,
      format: "form-js",
      uiSchema: ui,
    });
    expect(row.format).toBe("form-js");
    expect(row.ui_schema).toEqual(ui);
  });
});
