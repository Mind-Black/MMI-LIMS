-- Enable RLS on bookings if not already enabled
ALTER TABLE bookings ENABLE ROW LEVEL SECURITY;

-- Policy for viewing bookings (everyone can see availability)
-- We drop existing policies first to avoid conflicts
DROP POLICY IF EXISTS "Bookings are viewable by everyone" ON bookings;
CREATE POLICY "Bookings are viewable by everyone" 
ON bookings FOR SELECT 
USING (true);

-- Policy for inserting bookings (authenticated users only)
DROP POLICY IF EXISTS "Users can create bookings" ON bookings;
CREATE POLICY "Users can create bookings" 
ON bookings FOR INSERT 
WITH CHECK (auth.role() = 'authenticated');

-- Policy for deleting bookings (Owners and Admins)
DROP POLICY IF EXISTS "Users can delete own bookings" ON bookings;
CREATE POLICY "Users can delete own bookings" 
ON bookings FOR DELETE 
USING (
  auth.uid() = user_id 
  OR 
  EXISTS (
    SELECT 1 FROM profiles 
    WHERE id = auth.uid() 
    AND access_level = 'admin'
  )
);

-- Policy for updating bookings (Owners and Admins)
DROP POLICY IF EXISTS "Users can update own bookings" ON bookings;
CREATE POLICY "Users can update own bookings" 
ON bookings FOR UPDATE 
USING (
  auth.uid() = user_id 
  OR 
  EXISTS (
    SELECT 1 FROM profiles 
    WHERE id = auth.uid() 
    AND access_level = 'admin'
  )
);
