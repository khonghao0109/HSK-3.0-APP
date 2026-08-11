-- CMS Lite reliability closeout: review decisions are append-only facts.
-- New decisions remain INSERT-only rows; prior decisions cannot be rewritten
-- or removed because the latest row is authoritative for publishing.

CREATE TRIGGER "ContentReview_immutable"
BEFORE UPDATE OR DELETE ON "ContentReview"
FOR EACH ROW EXECUTE FUNCTION "hsk_reject_immutable_mutation"();
