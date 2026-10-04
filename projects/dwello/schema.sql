-- Dwello is an original local learning rebuild. All seeded records are fictional.
CREATE EXTENSION IF NOT EXISTS btree_gist SCHEMA public;

CREATE TABLE IF NOT EXISTS properties (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  address text NOT NULL,
  city text NOT NULL
);

CREATE TABLE IF NOT EXISTS units (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  property_id integer NOT NULL REFERENCES properties(id),
  number text NOT NULL,
  floor integer NOT NULL CHECK (floor BETWEEN 1 AND 100),
  bedrooms integer NOT NULL CHECK (bedrooms BETWEEN 0 AND 10),
  monthly_rent_cents integer NOT NULL CHECK (monthly_rent_cents > 0),
  UNIQUE(property_id, number)
);

CREATE TABLE IF NOT EXISTS tenants (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name text NOT NULL CHECK (length(name) BETWEEN 2 AND 100),
  email text NOT NULL UNIQUE CHECK (email = lower(email) AND length(email) <= 254)
);

-- trace: lease-constraint
CREATE TABLE IF NOT EXISTS leases (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  unit_id integer NOT NULL REFERENCES units(id),
  tenant_id integer NOT NULL REFERENCES tenants(id),
  start_date date NOT NULL CHECK (extract(day FROM start_date) = 1),
  end_date date NOT NULL CHECK (end_date >= start_date AND
    end_date = (date_trunc('month', end_date) + interval '1 month - 1 day')::date),
  monthly_rent_cents integer NOT NULL CHECK (monthly_rent_cents > 0),
  EXCLUDE USING gist (unit_id WITH =, daterange(start_date, end_date, '[]') WITH &&)
);
CREATE INDEX IF NOT EXISTS leases_tenant_idx ON leases(tenant_id);

CREATE TABLE IF NOT EXISTS payments (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  lease_id integer NOT NULL REFERENCES leases(id),
  month date NOT NULL CHECK (extract(day FROM month) = 1),
  amount_cents integer NOT NULL CHECK (amount_cents > 0),
  paid_on date NOT NULL,
  method text NOT NULL CHECK (method IN ('bank','cash','check')),
  note text NOT NULL DEFAULT '' CHECK (length(note) <= 240),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS payments_lease_month_idx ON payments(lease_id, month);

-- trace: payment-constraint
-- The row lock serializes concurrent receipts even outside the HTTP application.
-- Updating/deleting receipts is intentionally not supported by this demo.
CREATE OR REPLACE FUNCTION enforce_payment_balance() RETURNS trigger AS $$
DECLARE
  lease_row leases%ROWTYPE;
  already_paid bigint;
BEGIN
  SELECT * INTO lease_row FROM leases WHERE id = NEW.lease_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Unknown lease' USING ERRCODE = '23503';
  END IF;
  IF NOT (daterange(lease_row.start_date, lease_row.end_date, '[]') &&
          daterange(NEW.month, (NEW.month + interval '1 month')::date, '[)')) THEN
    RAISE EXCEPTION 'Payment month is outside the lease' USING ERRCODE = '23514';
  END IF;
  SELECT coalesce(sum(amount_cents), 0) INTO already_paid
    FROM payments WHERE lease_id = NEW.lease_id AND month = NEW.month
      AND id IS DISTINCT FROM NEW.id;
  IF already_paid + NEW.amount_cents > lease_row.monthly_rent_cents THEN
    RAISE EXCEPTION 'Payment exceeds monthly rent' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS payment_balance_guard ON payments;
CREATE TRIGGER payment_balance_guard BEFORE INSERT OR UPDATE ON payments
  FOR EACH ROW EXECUTE FUNCTION enforce_payment_balance();
