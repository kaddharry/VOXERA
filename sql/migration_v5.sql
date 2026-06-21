-- VOXERA: Sprint 4 - Full Booking Workflows Migration
-- Run this in your Supabase SQL Editor AFTER migration_v4.sql

-- =============================================================
-- Alter reservations table to support customer details and event id
-- =============================================================
ALTER TABLE public.reservations 
ADD COLUMN IF NOT EXISTS "customerName" text,
ADD COLUMN IF NOT EXISTS "customerEmail" text,
ADD COLUMN IF NOT EXISTS "customerPhone" text,
ADD COLUMN IF NOT EXISTS "calendarEventId" text;

-- =============================================================
-- Create atomic reservation function to prevent double bookings
-- =============================================================
CREATE OR REPLACE FUNCTION create_reservation_atomic(
  p_booking_id text,
  p_user_id text,
  p_client_id text,
  p_date text,
  p_time text,
  p_party_size integer,
  p_cust_name text,
  p_cust_email text,
  p_cust_phone text
) RETURNS jsonb AS $$
DECLARE
  v_count integer;
  v_result jsonb;
BEGIN
  -- 1. Acquire transaction-level advisory lock based on date/time/client slot
  -- Ensures concurrent bookings for the SAME slot check sequentially
  PERFORM pg_advisory_xact_lock(hashtext(p_client_id || '_' || p_date || '_' || p_time));
  
  -- 2. Count existing confirmed reservations for this slot (client scoped)
  SELECT count(*) INTO v_count 
  FROM public.reservations 
  WHERE "clientId" = p_client_id 
    AND date = p_date 
    AND time = p_time 
    AND status = 'confirmed';
  
  -- 3. Assert count is less than 2
  IF v_count >= 2 THEN
    RAISE EXCEPTION 'Slot % at % is fully booked.', p_date, p_time;
  END IF;
  
  -- 4. Insert new reservation
  INSERT INTO public.reservations (
    id, "userId", "clientId", status, date, time, "partySize", 
    "customerName", "customerEmail", "customerPhone"
  )
  VALUES (
    p_booking_id, p_user_id, p_client_id, 'confirmed', p_date, p_time, p_party_size, 
    p_cust_name, p_cust_email, p_cust_phone
  );
  
  -- 5. Return the created row as JSON
  RETURN json_build_object(
    'id', p_booking_id,
    'userId', p_user_id,
    'clientId', p_client_id,
    'status', 'confirmed',
    'date', p_date,
    'time', p_time,
    'partySize', p_party_size,
    'customerName', p_cust_name,
    'customerEmail', p_cust_email,
    'customerPhone', p_cust_phone
  );
END;
$$ LANGUAGE plpgsql;
