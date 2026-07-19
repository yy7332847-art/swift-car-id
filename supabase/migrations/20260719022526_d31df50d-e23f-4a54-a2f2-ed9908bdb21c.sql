ALTER TABLE public.plate_batches
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS activated_at timestamp with time zone DEFAULT now();

UPDATE public.plate_batches pb
SET is_active = (pb.created_at = latest.max_created_at),
    activated_at = CASE WHEN pb.created_at = latest.max_created_at THEN COALESCE(pb.activated_at, pb.created_at) ELSE pb.activated_at END
FROM (
  SELECT user_id, max(created_at) AS max_created_at
  FROM public.plate_batches
  GROUP BY user_id
) latest
WHERE pb.user_id = latest.user_id;

CREATE UNIQUE INDEX IF NOT EXISTS one_active_plate_batch_per_user
ON public.plate_batches(user_id)
WHERE is_active;

ALTER TABLE public.detected_plates
  ADD COLUMN IF NOT EXISTS confidence numeric(4,3),
  ADD COLUMN IF NOT EXISTS suspect_part text,
  ADD COLUMN IF NOT EXISTS correction_note text;

CREATE OR REPLACE FUNCTION public.set_active_plate_batch(_batch_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _owner uuid;
BEGIN
  SELECT user_id INTO _owner
  FROM public.plate_batches
  WHERE id = _batch_id;

  IF _owner IS NULL THEN
    RAISE EXCEPTION 'batch_not_found';
  END IF;

  IF auth.uid() <> _owner AND NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  UPDATE public.plate_batches
  SET is_active = false
  WHERE user_id = _owner;

  UPDATE public.plate_batches
  SET is_active = true,
      activated_at = now()
  WHERE id = _batch_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_active_plate_batch(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_active_plate_batch(uuid) TO service_role;