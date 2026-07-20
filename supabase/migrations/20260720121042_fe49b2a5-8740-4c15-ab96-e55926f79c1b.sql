
-- Smart duplicate detection: link duplicate captures to their original and record user decision
ALTER TABLE public.detected_plates
  ADD COLUMN IF NOT EXISTS duplicate_of_id uuid REFERENCES public.detected_plates(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS duplicate_decision text CHECK (duplicate_decision IN ('same','different','unresolved')) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS duplicate_distance_m double precision,
  ADD COLUMN IF NOT EXISTS duplicate_gap_seconds integer;

CREATE INDEX IF NOT EXISTS detected_plates_duplicate_of_idx ON public.detected_plates(duplicate_of_id);
CREATE INDEX IF NOT EXISTS detected_plates_session_normalized_idx ON public.detected_plates(session_id, plate_normalized);

-- Add unique_cars aggregate column to sessions (excludes rows marked as duplicate)
ALTER TABLE public.recognition_sessions
  ADD COLUMN IF NOT EXISTS total_unique integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_duplicates integer NOT NULL DEFAULT 0;
