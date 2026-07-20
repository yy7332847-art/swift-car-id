
ALTER TABLE public.detected_plates
  ADD COLUMN IF NOT EXISTS latitude double precision,
  ADD COLUMN IF NOT EXISTS longitude double precision,
  ADD COLUMN IF NOT EXISTS accuracy double precision;

ALTER TABLE public.recognition_sessions
  ADD COLUMN IF NOT EXISTS path jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS start_latitude double precision,
  ADD COLUMN IF NOT EXISTS start_longitude double precision;
