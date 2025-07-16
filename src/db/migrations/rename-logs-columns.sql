-- Rename script_name and script_type columns in logs table to event_name and event_type
-- This aligns with the terminology change from "scripts" to "events" throughout the system

ALTER TABLE logs 
  RENAME COLUMN script_name TO event_name;

ALTER TABLE logs 
  RENAME COLUMN script_type TO event_type;