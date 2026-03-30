-- Add per-item door unlock requirement flag.
-- true: student sign-outs/sign-ins should use the door unlock flow for this item.
-- false: item is not behind the controlled door and can bypass hardware unlock.
ALTER TABLE inventory_items
ADD COLUMN IF NOT EXISTS requires_door_unlock boolean NOT NULL DEFAULT true;

-- Backfill nulls defensively for existing rows.
UPDATE inventory_items
SET requires_door_unlock = true
WHERE requires_door_unlock IS NULL;
