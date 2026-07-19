
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.activate_subscription(uuid, integer) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.deactivate_subscription(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.activate_subscription(uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.deactivate_subscription(uuid) TO authenticated;
