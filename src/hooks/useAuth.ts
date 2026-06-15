import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Session, User } from "@supabase/supabase-js";

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [sessionLoading, setSessionLoading] = useState(true);
  const [roleLoading, setRoleLoading] = useState(true);
  const [roleCheckedFor, setRoleCheckedFor] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    const syncSession = (sess: Session | null) => {
      if (!mounted) return;
      setRoleLoading(!!sess?.user);
      setSession(sess);
      setUser(sess?.user ?? null);
      setSessionLoading(false);
    };

    const { data: sub } = supabase.auth.onAuthStateChange((_event, sess) => {
      syncSession(sess);
    });

    supabase.auth.getSession().then(({ data }) => void syncSession(data.session));

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const checkAdminRole = async () => {
      if (!user) {
        setIsAdmin(false);
        setRoleCheckedFor(null);
        setRoleLoading(false);
        return;
      }

      setRoleCheckedFor(null);
      setRoleLoading(true);

      const { data } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user.id)
        .eq("role", "admin")
        .maybeSingle();

      if (!cancelled) {
        setIsAdmin(!!data);
        setRoleCheckedFor(user.id);
        setRoleLoading(false);
      }
    };

    void checkAdminRole();

    return () => {
      cancelled = true;
    };
  }, [user]);

  return {
    user,
    session,
    isAdmin,
    loading: sessionLoading || roleLoading || (!!user && roleCheckedFor !== user.id),
  };
}
