ALTER FUNCTION public.set_active_plate_batch(uuid) SECURITY INVOKER;
REVOKE EXECUTE ON FUNCTION public.set_active_plate_batch(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.set_active_plate_batch(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.set_active_plate_batch(uuid) TO authenticated;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'plate_batches'
      AND policyname = 'Admins can manage all plate batches'
  ) THEN
    CREATE POLICY "Admins can manage all plate batches"
    ON public.plate_batches
    FOR ALL
    TO authenticated
    USING (public.has_role(auth.uid(), 'admin'))
    WITH CHECK (public.has_role(auth.uid(), 'admin'));
  END IF;
END $$;