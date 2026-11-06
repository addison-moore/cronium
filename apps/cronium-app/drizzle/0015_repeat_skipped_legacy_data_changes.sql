-- cronium:custom-migration
-- On a database from the old drizzle-kit push flow, run-migrations.cjs stamps every
-- migration and executes only the ones carrying the marker above. 0012 and 0013
-- change data and have no marker, so those databases skipped both changes. Editing
-- them wouldn't reach a database already stamped past them, so this repeats them. It
-- runs on every database, and where they already ran it rewrites no row.
--
-- 0012 removed webhook header values from webhook_deliveries.headers. The column is
-- unencrypted and returned by the delivery-history API, and it used to record each
-- request's custom headers right after they were decrypted. Those are usually
-- credentials.
--
-- 0012's statement can't be repeated as it stands. A delivery written since then keeps
-- each custom header's name with the value "[redacted]", and 0012 would remove those
-- names. So an entry stays if it is one of the same system headers or holds exactly
-- that placeholder, and a row from before the fix ends up as 0012 leaves one. Like
-- 0012, this can't tell a custom header given a system header's name from the real
-- one, so that value stays.
--
-- No code ever wrote a value here that isn't an object. One can't be read by header
-- name, so it can't be shown to be clean, and it is emptied.
WITH "scrubbed" AS (
  SELECT
    delivery."id",
    (
      SELECT COALESCE(jsonb_object_agg(entry.key, entry.value), '{}'::jsonb)
      FROM jsonb_each(
        CASE jsonb_typeof(delivery."headers")
          WHEN 'object' THEN delivery."headers"
          ELSE '{}'::jsonb
        END
      ) AS entry
      WHERE lower(entry.key) IN (
        'content-type',
        'x-webhook-id',
        'x-webhook-event',
        'x-webhook-timestamp',
        'x-delivery-id'
      )
        OR entry.value = '"[redacted]"'::jsonb
    ) AS "headers"
  FROM "webhook_deliveries" AS delivery
  WHERE jsonb_typeof(delivery."headers") <> 'null'
)
UPDATE "webhook_deliveries" AS delivery
SET "headers" = scrubbed."headers"
FROM "scrubbed" AS scrubbed
WHERE delivery."id" = scrubbed."id"
  AND delivery."headers" <> scrubbed."headers";
--> statement-breakpoint
-- 0013 removed this setting, which never had any effect. Its comment says why.
DELETE FROM "system_settings" WHERE "key" = 'logRetentionDays';
