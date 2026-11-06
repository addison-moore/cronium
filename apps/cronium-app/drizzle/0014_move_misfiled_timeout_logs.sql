-- cronium:custom-migration
-- The workflow cleanup service wrote its timeout line with the run's id in
-- workflow_logs.workflow_id and no owner, so the line sat on whichever workflow
-- shared that number, possibly another user's, and the run's own workflow showed
-- nothing. This moves those lines to the run's workflow and owner.
--
-- A line moves only when it can be tied to its run: no owner, the status, level and
-- message only that code wrote, and a timestamp equal to the completed_at of the
-- timed-out run with that id, because the code wrote both from one value. The rest
-- stay where they are: a line whose run has since been deleted, and the first line
-- of a run timed out twice, whose completed_at the second call overwrote.
UPDATE "workflow_logs" AS wl
SET "workflow_id" = we."workflow_id", "user_id" = we."user_id"
FROM "workflow_executions" AS we
WHERE wl."workflow_id" = we."id"
  AND wl."user_id" IS NULL
  AND wl."status" = 'TIMEOUT'
  AND wl."level" = 'ERROR'
  AND wl."message" LIKE 'Workflow execution timed out after %'
  AND we."status" = 'TIMEOUT'
  AND wl."timestamp" = we."completed_at";
