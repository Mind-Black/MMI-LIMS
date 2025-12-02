-- Migration V2: Improve Data Types and Integrity

-- 1. Convert date and time columns to proper types
-- Note: We need to handle potential conversion errors if existing data is bad.
-- Assuming format YYYY-MM-DD and HH:MM

ALTER TABLE bookings 
  ALTER COLUMN date TYPE date USING date::date,
  ALTER COLUMN time TYPE time USING time::time;

-- 2. Add constraint to prevent double bookings
-- We'll use a function and a trigger for this.

CREATE OR REPLACE FUNCTION check_double_booking()
RETURNS TRIGGER AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM bookings
    WHERE tool_id = NEW.tool_id
      AND date = NEW.date
      AND time = NEW.time
      AND id != NEW.id -- Allow updating the same booking (though usually we don't update bookings this way)
  ) THEN
    RAISE EXCEPTION 'Double booking detected for tool % on % at %', NEW.tool_id, NEW.date, NEW.time;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER prevent_double_booking
  BEFORE INSERT OR UPDATE ON bookings
  FOR EACH ROW
  EXECUTE FUNCTION check_double_booking();
