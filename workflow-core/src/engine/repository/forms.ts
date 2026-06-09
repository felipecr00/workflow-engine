import type { Kysely, Transaction } from "kysely";
import { v4 as uuid } from "uuid";
import type { Database, FormFormat } from "../db/types";

export interface FormRow {
  id: string;
  tenant_id: string;
  key: string;
  version: number;
  schema: Record<string, unknown>;
  format: FormFormat;
  ui_schema: Record<string, unknown> | null;
  deployed_at: Date;
}

type DbOrTrx = Kysely<Database> | Transaction<Database>;

const DEFAULT_TENANT = "default";

export async function deployForm(
  db: Kysely<Database>,
  params: {
    key: string;
    schema: Record<string, unknown>;
    format?: FormFormat;
    uiSchema?: Record<string, unknown> | null;
  },
): Promise<FormRow> {
  return await db.transaction().execute(async (trx) => {
    const latest = await findLatestFormByKey(trx, params.key);
    const format: FormFormat = params.format ?? "form-js";

    // Idempotency: if the latest deployed version has the same format and
    // a deeply-equal schema, reuse it instead of bumping the version. The
    // ui_schema is intentionally not part of the equality check — it's
    // presentation only and changing it shouldn't churn versions.
    if (
      latest &&
      latest.format === format &&
      deepEqual(latest.schema, params.schema)
    ) {
      return latest;
    }

    const nextVersion = (latest?.version ?? 0) + 1;
    const row = await trx
      .insertInto("forms")
      .values({
        id: uuid(),
        tenant_id: DEFAULT_TENANT,
        key: params.key,
        version: nextVersion,
        schema: JSON.stringify(params.schema) as unknown as never,
        format,
        ui_schema: (params.uiSchema
          ? JSON.stringify(params.uiSchema)
          : null) as unknown as never,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    return row as FormRow;
  });
}

export async function findLatestFormByKey(
  db: DbOrTrx,
  key: string,
): Promise<FormRow | null> {
  const row = await db
    .selectFrom("forms")
    .selectAll()
    .where("tenant_id", "=", DEFAULT_TENANT)
    .where("key", "=", key)
    .orderBy("version", "desc")
    .limit(1)
    .executeTakeFirst();
  return (row as FormRow | undefined) ?? null;
}

export async function findFormByKeyAndVersion(
  db: DbOrTrx,
  key: string,
  version: number,
): Promise<FormRow | null> {
  const row = await db
    .selectFrom("forms")
    .selectAll()
    .where("tenant_id", "=", DEFAULT_TENANT)
    .where("key", "=", key)
    .where("version", "=", version)
    .executeTakeFirst();
  return (row as FormRow | undefined) ?? null;
}

// Return the latest version of every deployed form, ordered by key. The
// picker UI (Sprint 2) uses this; we ship it now so the route exists.
export async function listForms(db: DbOrTrx): Promise<FormRow[]> {
  const rows = await db
    .selectFrom("forms as f")
    .selectAll("f")
    .where("f.tenant_id", "=", DEFAULT_TENANT)
    .where((eb) =>
      eb(
        "f.version",
        "=",
        eb
          .selectFrom("forms as f2")
          .select((eb2) => eb2.fn.max<number>("f2.version").as("v"))
          .where("f2.tenant_id", "=", DEFAULT_TENANT)
          .whereRef("f2.key", "=", "f.key"),
      ),
    )
    .orderBy("f.key", "asc")
    .execute();
  return rows as FormRow[];
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return a === b;
  if (typeof a !== "object") return false;
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i])) return false;
    }
    return true;
  }
  if (Array.isArray(b)) return false;
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const ak = Object.keys(ao);
  const bk = Object.keys(bo);
  if (ak.length !== bk.length) return false;
  for (const k of ak) {
    if (!Object.prototype.hasOwnProperty.call(bo, k)) return false;
    if (!deepEqual(ao[k], bo[k])) return false;
  }
  return true;
}
