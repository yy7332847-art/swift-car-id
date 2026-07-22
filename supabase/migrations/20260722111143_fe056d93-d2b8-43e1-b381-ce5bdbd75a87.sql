
REVOKE EXECUTE ON FUNCTION public.activate_subscription(uuid, integer) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.deactivate_subscription(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.create_purchase_request(uuid, text, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_suspend_user(uuid, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_unsuspend_user(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_set_role(uuid, public.app_role) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_activate_package(uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_process_request(uuid, boolean, text) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.activate_subscription(uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.deactivate_subscription(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_purchase_request(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_suspend_user(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_unsuspend_user(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_role(uuid, public.app_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_activate_package(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_process_request(uuid, boolean, text) TO authenticated;
