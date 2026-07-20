
ALTER TABLE public.recognition_sessions ADD COLUMN IF NOT EXISTS client_id text;
ALTER TABLE public.detected_plates ADD COLUMN IF NOT EXISTS client_id text;

CREATE UNIQUE INDEX IF NOT EXISTS recognition_sessions_user_client_uidx
  ON public.recognition_sessions(user_id, client_id) WHERE client_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS detected_plates_user_client_uidx
  ON public.detected_plates(user_id, client_id) WHERE client_id IS NOT NULL;
