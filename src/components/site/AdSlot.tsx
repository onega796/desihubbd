import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

type Position = "header" | "sidebar" | "footer" | "mid";

export function AdSlot({ position, className }: { position: Position; className?: string }) {
  const [code, setCode] = useState<string | null>(null);
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
