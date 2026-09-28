BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS luna_billing_reservation_entry_idx
  ON luna.billing_ledger (reservation_id, entry_type)
  WHERE reservation_id IS NOT NULL;

COMMIT;
