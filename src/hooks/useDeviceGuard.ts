import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

const DEVICE_KEY = "device_id";

function getDeviceId(): string {
  if (typeof window === "undefined") return "";
  let id = localStorage.getItem(DEVICE_KEY);
  if (!id) {
    id = (crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`);
    localStorage.setItem(DEVICE_KEY, id);
  }
  return id;
}

async function claimDevice(userId: string) {
  const deviceId = getDeviceId();
  return (supabase as any)
    .from("profiles")
    .update({ active_device_id: deviceId, active_device_at: new Date().toISOString() })
    .eq("user_id", userId);
}

async function checkDevice(userId: string): Promise<boolean> {
  const deviceId = getDeviceId();
  const { data } = await (supabase as any)
    .from("profiles")
    .select("active_device_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (!data?.active_device_id) return true; // no claim yet
  return data.active_device_id === deviceId;
}

/**
 * Mount once at the app root. When a user signs in, the current device id is
 * registered on the profile. If another device later signs in with the same
 * account, this device is signed out automatically.
 */
export function useDeviceGuard() {
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    let disposed = false;

    const startPolling = (userId: string) => {
      if (timer) clearInterval(timer);
      timer = setInterval(() => {
        if (disposed) return;
        const ok = await checkDevice(userId);
        if (!ok) {
          toast.error("Signed out: account opened on another device.");
          await supabase.auth.signOut();
        }
      }, 20000);
    };

    const stopPolling = () => {
      if (timer) { clearInterval(timer); timer = null; }
    };

    const initSession = async () => {
      const { data } = await supabase.auth.getSession();
      const userId = data.session?.user?.id;
      if (!userId || disposed) return;

      const { data: profile } = await (supabase as any)
        .from("profiles")
        .select("active_device_id")
        .eq("user_id", userId)
        .maybeSingle();

      const deviceId = getDeviceId();
      if (!profile?.active_device_id) {
        await claimDevice(userId);
      } else if (profile.active_device_id !== deviceId) {
        toast.error("Signed out: account opened on another device.");
        await supabase.auth.signOut();
        return;
      }

      startPolling(userId);
    };

    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      const userId = session?.user?.id ?? null;
      if (event === "SIGNED_IN" && userId) {
        void claimDevice(userId);
        startPolling(userId);
      } else if (event === "SIGNED_OUT") {
        stopPolling();
      }
    });

    void initSession();

    return () => {
      disposed = true;
      stopPolling();
      sub.subscription.unsubscribe();
    };
  }, []);
}
