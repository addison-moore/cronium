-- cronium:custom-migration
-- Normalize the one legacy representation we can prove is an empty list.
UPDATE "workflows"
SET "override_server_ids" = '[]'::jsonb
WHERE jsonb_typeof("override_server_ids") = 'string'
  AND "override_server_ids" #>> '{}' = '[]';
--> statement-breakpoint

-- Refuse to install guards over unknown or cross-tenant legacy data. Operators
-- must inspect and explicitly repair those rows rather than silently reassigning
-- ownership during a migration.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "events" e
    JOIN "servers" s ON s."id" = e."server_id"
    WHERE e."server_id" IS NOT NULL AND e."user_id" <> s."user_id"
  ) THEN
    RAISE EXCEPTION 'cross-tenant events.server_id relationship detected'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "event_servers" es
    JOIN "events" e ON e."id" = es."event_id"
    JOIN "servers" s ON s."id" = es."server_id"
    WHERE e."user_id" <> s."user_id"
  ) THEN
    RAISE EXCEPTION 'cross-tenant event_servers relationship detected'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "workflow_nodes" wn
    JOIN "workflows" w ON w."id" = wn."workflow_id"
    JOIN "events" e ON e."id" = wn."event_id"
    WHERE w."user_id" <> e."user_id"
  ) THEN
    RAISE EXCEPTION 'cross-tenant workflow_nodes relationship detected'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "server_group_members" sgm
    JOIN "server_groups" sg ON sg."id" = sgm."group_id"
    JOIN "servers" s ON s."id" = sgm."server_id"
    WHERE sg."user_id" <> s."user_id"
  ) THEN
    RAISE EXCEPTION 'cross-tenant server_group_members relationship detected'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "workflows" w
    WHERE w."override_server_ids" IS NOT NULL
      AND jsonb_typeof(w."override_server_ids") <> 'array'
  ) THEN
    RAISE EXCEPTION 'invalid workflows.override_server_ids shape detected'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "workflows" w
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE
        WHEN jsonb_typeof(w."override_server_ids") = 'array'
          THEN w."override_server_ids"
        ELSE '[]'::jsonb
      END
    ) AS override_id
    WHERE jsonb_typeof(override_id) <> 'number'
      OR override_id::text !~ '^[0-9]+$'
  ) THEN
    RAISE EXCEPTION 'non-integer workflows.override_server_ids value detected'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "workflows" w
    CROSS JOIN LATERAL jsonb_array_elements(
      COALESCE(w."override_server_ids", '[]'::jsonb)
    ) AS override_id
    LEFT JOIN "servers" s ON s."id" = (override_id::text)::integer
    WHERE s."id" IS NULL OR s."user_id" <> w."user_id"
  ) THEN
    RAISE EXCEPTION 'missing or cross-tenant workflow override server detected'
      USING ERRCODE = '23514';
  END IF;
END;
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION cronium_assert_tenant_owner_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD."user_id" IS DISTINCT FROM NEW."user_id" THEN
    RAISE EXCEPTION 'tenant owner cannot change for %', TG_TABLE_NAME
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER events_tenant_owner_immutable
BEFORE UPDATE OF "user_id" ON "events"
FOR EACH ROW EXECUTE FUNCTION cronium_assert_tenant_owner_immutable();
--> statement-breakpoint
CREATE TRIGGER servers_tenant_owner_immutable
BEFORE UPDATE OF "user_id" ON "servers"
FOR EACH ROW EXECUTE FUNCTION cronium_assert_tenant_owner_immutable();
--> statement-breakpoint
CREATE TRIGGER workflows_tenant_owner_immutable
BEFORE UPDATE OF "user_id" ON "workflows"
FOR EACH ROW EXECUTE FUNCTION cronium_assert_tenant_owner_immutable();
--> statement-breakpoint
CREATE TRIGGER server_groups_tenant_owner_immutable
BEFORE UPDATE OF "user_id" ON "server_groups"
FOR EACH ROW EXECUTE FUNCTION cronium_assert_tenant_owner_immutable();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION cronium_assert_event_direct_server_owner()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."server_id" IS NULL THEN
    RETURN NEW;
  END IF;

  PERFORM 1
  FROM "servers" s
  WHERE s."id" = NEW."server_id" AND s."user_id" = NEW."user_id";
  IF NOT FOUND THEN
    RAISE EXCEPTION 'event server must be owned by the event owner'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER events_direct_server_owner
BEFORE INSERT OR UPDATE OF "user_id", "server_id" ON "events"
FOR EACH ROW EXECUTE FUNCTION cronium_assert_event_direct_server_owner();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION cronium_assert_event_server_owner()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM 1
  FROM "events" e
  JOIN "servers" s ON s."id" = NEW."server_id"
  WHERE e."id" = NEW."event_id" AND e."user_id" = s."user_id";
  IF NOT FOUND THEN
    RAISE EXCEPTION 'event and server must have the same owner'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER event_servers_owner
BEFORE INSERT OR UPDATE OF "event_id", "server_id" ON "event_servers"
FOR EACH ROW EXECUTE FUNCTION cronium_assert_event_server_owner();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION cronium_assert_workflow_node_owner()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM 1
  FROM "workflows" w
  JOIN "events" e ON e."id" = NEW."event_id"
  WHERE w."id" = NEW."workflow_id" AND w."user_id" = e."user_id";
  IF NOT FOUND THEN
    RAISE EXCEPTION 'workflow and event must have the same owner'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER workflow_nodes_owner
BEFORE INSERT OR UPDATE OF "workflow_id", "event_id" ON "workflow_nodes"
FOR EACH ROW EXECUTE FUNCTION cronium_assert_workflow_node_owner();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION cronium_assert_server_group_member_owner()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM 1
  FROM "server_groups" sg
  JOIN "servers" s ON s."id" = NEW."server_id"
  WHERE sg."id" = NEW."group_id" AND sg."user_id" = s."user_id";
  IF NOT FOUND THEN
    RAISE EXCEPTION 'server group and server must have the same owner'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER server_group_members_owner
BEFORE INSERT OR UPDATE OF "group_id", "server_id" ON "server_group_members"
FOR EACH ROW EXECUTE FUNCTION cronium_assert_server_group_member_owner();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION cronium_assert_workflow_override_server_owners()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."override_server_ids" IS NULL THEN
    RETURN NEW;
  END IF;
  IF jsonb_typeof(NEW."override_server_ids") <> 'array' THEN
    RAISE EXCEPTION 'workflow override_server_ids must be an array'
      USING ERRCODE = '23514';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(NEW."override_server_ids") AS override_id
    WHERE jsonb_typeof(override_id) <> 'number'
      OR override_id::text !~ '^[0-9]+$'
  ) THEN
    RAISE EXCEPTION 'workflow override_server_ids must contain integer IDs'
      USING ERRCODE = '23514';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(NEW."override_server_ids") AS override_id
    LEFT JOIN "servers" s ON s."id" = (override_id::text)::integer
    WHERE s."id" IS NULL OR s."user_id" <> NEW."user_id"
  ) THEN
    RAISE EXCEPTION 'workflow override servers must be owned by the workflow owner'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER workflows_override_server_owners
BEFORE INSERT OR UPDATE OF "user_id", "override_server_ids" ON "workflows"
FOR EACH ROW EXECUTE FUNCTION cronium_assert_workflow_override_server_owners();
