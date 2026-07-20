
-- Packages catalog
CREATE TABLE public.packages (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL,
  description text,
  duration_days integer NOT NULL,
  price_egp numeric(10,2) NOT NULL DEFAULT 0,
  is_free boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  max_uploads integer,
  max_sessions_per_day integer,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.packages TO anon, authenticated;
GRANT ALL ON public.packages TO service_role;
GRANT INSERT, UPDATE, DELETE ON public.packages TO authenticated;
ALTER TABLE public.packages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pkg read" ON public.packages FOR SELECT TO authenticated, anon USING (true);
CREATE POLICY "pkg admin write" ON public.packages FOR ALL TO authenticated
  USING (has_role(auth.uid(),'admin')) WITH CHECK (has_role(auth.uid(),'admin'));

-- Extend subscriptions
ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS package_id uuid REFERENCES public.packages(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'inactive',
  ADD COLUMN IF NOT EXISTS suspend_reason text,
  ADD COLUMN IF NOT EXISTS suspended_at timestamptz;

-- Purchase requests
CREATE TABLE public.purchase_requests (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  package_id uuid NOT NULL REFERENCES public.packages(id) ON DELETE CASCADE,
  note text,
  contact text,
  status text NOT NULL DEFAULT 'pending',
  admin_note text,
  processed_by uuid REFERENCES auth.users(id),
  processed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.purchase_requests TO authenticated;
GRANT ALL ON public.purchase_requests TO service_role;
ALTER TABLE public.purchase_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pr self read" ON public.purchase_requests FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR has_role(auth.uid(),'admin'));
CREATE POLICY "pr self insert" ON public.purchase_requests FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);
CREATE POLICY "pr admin update" ON public.purchase_requests FOR UPDATE TO authenticated
  USING (has_role(auth.uid(),'admin')) WITH CHECK (has_role(auth.uid(),'admin'));

-- Seed 6 packages
INSERT INTO public.packages (name, description, duration_days, price_egp, is_free, sort_order) VALUES
  ('تجريبية مجانية', '٣ أيام مجانية عند إنشاء الحساب', 3, 0, true, 0),
  ('أسبوعية', 'اشتراك لمدة أسبوع كامل', 7, 150, false, 1),
  ('نصف شهرية', 'اشتراك لمدة أسبوعين', 15, 250, false, 2),
  ('شهرية', 'اشتراك شهر كامل', 30, 400, false, 3),
  ('ربع سنوية', 'اشتراك لمدة ٩٠ يوم', 90, 1000, false, 4),
  ('سنوية', 'اشتراك كامل لمدة عام', 365, 3500, false, 5)
ON CONFLICT DO NOTHING;

-- Updated handle_new_user: assigns free trial
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _trial_id uuid;
  _days integer;
BEGIN
  INSERT INTO public.profiles(id, email, full_name)
  VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'full_name',''));
  INSERT INTO public.user_roles(user_id, role) VALUES (NEW.id, 'user') ON CONFLICT DO NOTHING;

  SELECT id, duration_days INTO _trial_id, _days
  FROM public.packages WHERE is_free = true AND is_active = true
  ORDER BY sort_order LIMIT 1;

  INSERT INTO public.subscriptions(user_id, is_active, package_id, status, starts_at, expires_at)
  VALUES (
    NEW.id,
    _trial_id IS NOT NULL,
    _trial_id,
    CASE WHEN _trial_id IS NOT NULL THEN 'trial' ELSE 'inactive' END,
    now(),
    CASE WHEN _trial_id IS NOT NULL THEN now() + make_interval(days => COALESCE(_days,3)) ELSE NULL END
  )
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;$$;

-- Ensure trigger exists
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Admin: activate a package for a user
CREATE OR REPLACE FUNCTION public.admin_activate_package(_user_id uuid, _package_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _days integer; _is_free boolean;
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;
  SELECT duration_days, is_free INTO _days, _is_free FROM public.packages WHERE id = _package_id AND is_active = true;
  IF _days IS NULL THEN RAISE EXCEPTION 'package_not_found'; END IF;
  INSERT INTO public.subscriptions(user_id, is_active, package_id, status, starts_at, expires_at, suspend_reason, suspended_at)
  VALUES (_user_id, true, _package_id, CASE WHEN _is_free THEN 'trial' ELSE 'active' END, now(), now() + make_interval(days => _days), NULL, NULL)
  ON CONFLICT (user_id) DO UPDATE SET
    is_active = true, package_id = _package_id,
    status = CASE WHEN _is_free THEN 'trial' ELSE 'active' END,
    starts_at = now(), expires_at = now() + make_interval(days => _days),
    suspend_reason = NULL, suspended_at = NULL, updated_at = now();
END;$$;

-- Admin: suspend / unsuspend
CREATE OR REPLACE FUNCTION public.admin_suspend_user(_user_id uuid, _reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;
  INSERT INTO public.subscriptions(user_id, is_active, status, suspend_reason, suspended_at)
  VALUES (_user_id, false, 'suspended', _reason, now())
  ON CONFLICT (user_id) DO UPDATE SET
    is_active = false, status = 'suspended', suspend_reason = _reason, suspended_at = now(), updated_at = now();
END;$$;

CREATE OR REPLACE FUNCTION public.admin_unsuspend_user(_user_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;
  UPDATE public.subscriptions
  SET status = CASE WHEN expires_at IS NOT NULL AND expires_at > now() THEN 'active' ELSE 'inactive' END,
      is_active = COALESCE(expires_at > now(), false),
      suspend_reason = NULL, suspended_at = NULL, updated_at = now()
  WHERE user_id = _user_id;
END;$$;

-- Admin: set role
CREATE OR REPLACE FUNCTION public.admin_set_role(_user_id uuid, _role app_role)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;
  DELETE FROM public.user_roles WHERE user_id = _user_id;
  INSERT INTO public.user_roles(user_id, role) VALUES (_user_id, _role);
END;$$;

-- User: create purchase request
CREATE OR REPLACE FUNCTION public.create_purchase_request(_package_id uuid, _note text, _contact text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;
  INSERT INTO public.purchase_requests(user_id, package_id, note, contact)
  VALUES (auth.uid(), _package_id, _note, _contact)
  RETURNING id INTO _id;
  RETURN _id;
END;$$;

-- Admin: process request
CREATE OR REPLACE FUNCTION public.admin_process_request(_request_id uuid, _approve boolean, _admin_note text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid; _pid uuid;
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;
  SELECT user_id, package_id INTO _uid, _pid FROM public.purchase_requests WHERE id = _request_id;
  IF _uid IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;
  UPDATE public.purchase_requests
  SET status = CASE WHEN _approve THEN 'approved' ELSE 'rejected' END,
      admin_note = _admin_note, processed_by = auth.uid(), processed_at = now(), updated_at = now()
  WHERE id = _request_id;
  IF _approve THEN PERFORM public.admin_activate_package(_uid, _pid); END IF;
END;$$;

-- Backfill: give existing users with subs a status
UPDATE public.subscriptions
SET status = CASE
  WHEN is_active AND (expires_at IS NULL OR expires_at > now()) THEN 'active'
  WHEN expires_at IS NOT NULL AND expires_at <= now() THEN 'expired'
  ELSE 'inactive' END
WHERE status = 'inactive' OR status IS NULL;

-- Update timestamp trigger for packages & requests
CREATE OR REPLACE FUNCTION public.tg_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;$$;
DROP TRIGGER IF EXISTS packages_touch ON public.packages;
CREATE TRIGGER packages_touch BEFORE UPDATE ON public.packages FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();
DROP TRIGGER IF EXISTS pr_touch ON public.purchase_requests;
CREATE TRIGGER pr_touch BEFORE UPDATE ON public.purchase_requests FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();
