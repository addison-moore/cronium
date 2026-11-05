-- webhook_deliveries.headers recorded every outbound request header, including a
-- webhook's custom headers right after they were decrypted for sending. Those are
-- usually credentials (Authorization, API keys), and the column is unencrypted and
-- returned by the delivery-history API. New deliveries record only system headers
-- and the custom headers' names; this removes the values already stored.
UPDATE "webhook_deliveries"
SET "headers" = COALESCE(
  (
    SELECT jsonb_object_agg(entry.key, entry.value)
    FROM jsonb_each("webhook_deliveries"."headers") AS entry
    WHERE lower(entry.key) IN (
      'content-type',
      'x-webhook-id',
      'x-webhook-event',
      'x-webhook-timestamp',
      'x-delivery-id'
    )
  ),
  '{}'::jsonb
)
WHERE jsonb_typeof("headers") = 'object';
