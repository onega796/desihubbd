
-- Comment replies: parent_id reference
ALTER TABLE public.comments ADD COLUMN IF NOT EXISTS parent_id uuid REFERENCES public.comments(id) ON DELETE CASCADE;
ALTER TABLE public.comments ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS comments_parent_idx ON public.comments(parent_id);

-- Comment likes table (one per user per comment)
CREATE TABLE IF NOT EXISTS public.comment_likes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  comment_id uuid NOT NULL REFERENCES public.comments(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(comment_id, user_id)
);
GRANT SELECT, INSERT, DELETE ON public.comment_likes TO authenticated;
GRANT ALL ON public.comment_likes TO service_role;
ALTER TABLE public.comment_likes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users read all comment likes" ON public.comment_likes FOR SELECT TO authenticated USING (true);
CREATE POLICY "users insert own comment likes" ON public.comment_likes FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "users delete own comment likes" ON public.comment_likes FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- Trigger to sync comments.likes count
CREATE OR REPLACE FUNCTION public.sync_comment_likes() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.comments SET likes = likes + 1 WHERE id = NEW.comment_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE public.comments SET likes = GREATEST(0, likes - 1) WHERE id = OLD.comment_id;
  END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS comment_likes_sync ON public.comment_likes;
CREATE TRIGGER comment_likes_sync AFTER INSERT OR DELETE ON public.comment_likes
  FOR EACH ROW EXECUTE FUNCTION public.sync_comment_likes();

-- Video likes (per-user) so users can like/unlike videos
CREATE TABLE IF NOT EXISTS public.video_likes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  video_id uuid NOT NULL REFERENCES public.videos(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(video_id, user_id)
);
GRANT SELECT, INSERT, DELETE ON public.video_likes TO authenticated;
GRANT ALL ON public.video_likes TO service_role;
ALTER TABLE public.video_likes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users read all video likes" ON public.video_likes FOR SELECT TO authenticated USING (true);
CREATE POLICY "users insert own video likes" ON public.video_likes FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "users delete own video likes" ON public.video_likes FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.sync_video_likes() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.videos SET likes = likes + 1 WHERE id = NEW.video_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE public.videos SET likes = GREATEST(0, likes - 1) WHERE id = OLD.video_id;
  END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS video_likes_sync ON public.video_likes;
CREATE TRIGGER video_likes_sync AFTER INSERT OR DELETE ON public.video_likes
  FOR EACH ROW EXECUTE FUNCTION public.sync_video_likes();

-- Device tracking: one active device per user
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS active_device_id text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS active_device_at timestamptz;
