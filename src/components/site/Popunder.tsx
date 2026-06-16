import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export function Popunder() {
  const { user, loading } = useAuth();

  useEffect(() => {
    if (loading || !user) return;
    let cleanup: (() => void) | undefined;

    (async () => {
      const { data: prof } = await (supabase as any)
        .from("profiles").select("plan,plan_expires_at").eq("user_id", user.id).maybeSingle();
      const active = prof?.plan === "paid" &&
        (!prof?.plan_expires_at || new Date(prof.plan_expires_at) > new Date());
      if (active) return;

      const { data: ad } = await (supabase as any)
        .from("ads").select("popunder_url,ad_code,is_active,once_per_user")
        .eq("position", "popunder").maybeSingle();
      if (!ad?.is_active) return;
      const url = ad.popunder_url;
      if (!url) return;

      const key = `popunder_shown_${user.id}`;
      if (ad.once_per_user && localStorage.getItem(key)) return;

      const handler = () => {
        if (ad.once_per_user && localStorage.getItem(key)) return;
        try {
          const w = window.open(url, "_blank");
          if (w) w.blur();
          window.focus();
        } catch {}
        if (ad.once_per_user) localStorage.setItem(key, "1");
      };
      window.addEventListener("click", handler, { once: !!ad.once_per_user });
      cleanup = () => window.removeEventListener("click", handler);
    })();

    return () => { cleanup?.(); };
  }, [user, loading]);

  return null;
}
