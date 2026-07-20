
-- Audit log
CREATE TABLE public.admin_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id UUID NOT NULL,
  target_user_id UUID,
  action TEXT NOT NULL,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.admin_audit_log TO authenticated;
GRANT ALL ON public.admin_audit_log TO service_role;
ALTER TABLE public.admin_audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins view audit" ON public.admin_audit_log FOR SELECT
  USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins insert audit" ON public.admin_audit_log FOR INSERT
  WITH CHECK (public.has_role(auth.uid(), 'admin') AND admin_id = auth.uid());
CREATE INDEX idx_audit_created ON public.admin_audit_log (created_at DESC);
CREATE INDEX idx_audit_target ON public.admin_audit_log (target_user_id);

-- Subscription history
CREATE TABLE public.subscription_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  package_id UUID,
  package_name TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  status TEXT NOT NULL,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.subscription_history TO authenticated;
GRANT ALL ON public.subscription_history TO service_role;
ALTER TABLE public.subscription_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users see own history" ON public.subscription_history FOR SELECT
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));
CREATE INDEX idx_subhist_user ON public.subscription_history (user_id, created_at DESC);

-- Wrap admin RPCs to log automatically
CREATE OR REPLACE FUNCTION public.admin_activate_package(_user_id uuid, _package_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _days int; _name text; _prev record;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'not admin'; END IF;
  SELECT duration_days, name INTO _days, _name FROM public.packages WHERE id = _package_id;
  IF _days IS NULL THEN RAISE EXCEPTION 'package not found'; END IF;
  SELECT package_id, expires_at, status INTO _prev FROM public.subscriptions WHERE user_id = _user_id;
  IF _prev.package_id IS NOT NULL THEN
    INSERT INTO public.subscription_history(user_id, package_id, package_name, expires_at, ended_at, status, reason)
    VALUES (_user_id, _prev.package_id, (SELECT name FROM public.packages WHERE id = _prev.package_id), _prev.expires_at, now(), 'replaced', 'استبدال بباقة جديدة');
  END IF;
  INSERT INTO public.subscriptions (user_id, package_id, is_active, status, starts_at, expires_at, suspend_reason, suspended_at)
  VALUES (_user_id, _package_id, true, 'active', now(), now() + (_days || ' days')::interval, NULL, NULL)
  ON CONFLICT (user_id) DO UPDATE
    SET package_id = EXCLUDED.package_id, is_active = true, status = 'active',
        starts_at = now(), expires_at = now() + (_days || ' days')::interval,
        suspend_reason = NULL, suspended_at = NULL, updated_at = now();
  INSERT INTO public.subscription_history(user_id, package_id, package_name, expires_at, status)
  VALUES (_user_id, _package_id, _name, now() + (_days || ' days')::interval, 'active');
  INSERT INTO public.admin_audit_log(admin_id, target_user_id, action, details)
  VALUES (auth.uid(), _user_id, 'activate_package', jsonb_build_object('package_id', _package_id, 'package', _name, 'days', _days));
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_suspend_user(_user_id uuid, _reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'not admin'; END IF;
  UPDATE public.subscriptions SET status='suspended', is_active=false, suspend_reason=_reason, suspended_at=now(), updated_at=now()
  WHERE user_id = _user_id;
  INSERT INTO public.subscription_history(user_id, status, reason) VALUES (_user_id, 'suspended', _reason);
  INSERT INTO public.admin_audit_log(admin_id, target_user_id, action, details)
  VALUES (auth.uid(), _user_id, 'suspend_user', jsonb_build_object('reason', _reason));
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_unsuspend_user(_user_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'not admin'; END IF;
  UPDATE public.subscriptions SET status = CASE WHEN expires_at > now() THEN 'active' ELSE 'expired' END,
    is_active = expires_at > now(), suspend_reason=NULL, suspended_at=NULL, updated_at=now()
  WHERE user_id = _user_id;
  INSERT INTO public.subscription_history(user_id, status, reason) VALUES (_user_id, 'unsuspended', 'إعادة تفعيل');
  INSERT INTO public.admin_audit_log(admin_id, target_user_id, action, details)
  VALUES (auth.uid(), _user_id, 'unsuspend_user', '{}'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_process_request(_request_id uuid, _approve boolean, _admin_note text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid; _pkg uuid;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'not admin'; END IF;
  SELECT user_id, package_id INTO _uid, _pkg FROM public.purchase_requests WHERE id = _request_id;
  UPDATE public.purchase_requests SET status = CASE WHEN _approve THEN 'approved' ELSE 'rejected' END,
    admin_note = _admin_note, processed_at = now(), processed_by = auth.uid(), updated_at = now()
  WHERE id = _request_id;
  IF _approve THEN PERFORM public.admin_activate_package(_uid, _pkg); END IF;
  INSERT INTO public.admin_audit_log(admin_id, target_user_id, action, details)
  VALUES (auth.uid(), _uid, CASE WHEN _approve THEN 'approve_request' ELSE 'reject_request' END,
    jsonb_build_object('request_id', _request_id, 'note', _admin_note));
END;
$$;
