import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

type Position = "header" | "sidebar" | "footer" | "mid" | "popunder";

export function AdSlot({ position, className }: { position: Position; className?: string }) {
  const { user, loading } = useAuth();
  const [code, setCode] = useState<string | null>(null);
  const [hasActiveSub, setHasActiveSub] = useState<boolean | null>(null);

  // Check subscription status for the logged-in user
  useEffect(() => {
    if (loading) return;
    if (!user) { setHasActiveSub(false); return; }
    (supabase as any)
      .from("profiles")
      .select("plan,plan_expires_at")
      .eq("user_id", user.id)
      .maybeSingle()
      .then(({ data }: any) => {
        const active = data?.plan === "paid" &&
          (!data?.plan_expires_at || new Date(data.plan_expires_at) > new Date());
        setHasActiveSub(!!active);
      });
  }, [user, loading]);

  // Fetch ad code
  useEffect(() => {
    (supabase as any)
      .from("ads")
      .select("ad_code,is_active")
      .eq("position", position)
      .maybeSingle()
      .then(({ data }: any) => {
        if (data?.is_active && data.ad_code) setCode(data.ad_code);
      });
  }, [position]);

  // Show ads only to logged-in users WITHOUT an active subscription
  if (loading || hasActiveSub === null) return null;
  if (!user) return null;
  if (hasActiveSub) return null;
  if (!code) return null;

  return (
    <div className={className}>
      <iframe
        title={`${position} ad`}
        srcDoc={code}
        sandbox="allow-scripts allow-popups allow-forms allow-top-navigation-by-user-activation"
        className="w-full border-0"
        style={{ minHeight: 90 }}
      />
    </div>
  );
}
