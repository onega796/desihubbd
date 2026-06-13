-- Roles enum and table
CREATE TYPE public.app_role AS ENUM ('admin','user');

CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role app_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- Functions first (so policies can reference them)
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=_user_id AND role=_role) $$;

CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;
REVOKE EXECUTE ON FUNCTION public.touch_updated_at() FROM PUBLIC, anon, authenticated;

CREATE POLICY "users read own roles" ON public.user_roles FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "admins manage user_roles" ON public.user_roles
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

-- Profiles (referenced by handle_new_user)
CREATE TABLE public.profiles (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username TEXT,
  display_name TEXT,
  avatar_url TEXT,
  plan TEXT NOT NULL DEFAULT 'free' CHECK (plan IN ('free','paid')),
  plan_expires_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','banned','restricted')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users read own profile" ON public.profiles FOR SELECT TO authenticated USING (auth.uid() = user_id OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "users update own profile" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id AND status = 'active');
CREATE POLICY "admins manage profiles" ON public.profiles FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE TRIGGER profiles_touch BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.email = 'abirkhan0175@gmail.com' THEN
    INSERT INTO public.user_roles(user_id, role) VALUES (NEW.id, 'admin') ON CONFLICT DO NOTHING;
  END IF;
  INSERT INTO public.user_roles(user_id, role) VALUES (NEW.id, 'user') ON CONFLICT DO NOTHING;
  INSERT INTO public.profiles(user_id, username, display_name)
    VALUES (NEW.id, split_part(NEW.email,'@',1), split_part(NEW.email,'@',1))
    ON CONFLICT DO NOTHING;
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Categories
CREATE TABLE public.categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  image_url text,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.categories TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.categories TO authenticated;
GRANT ALL ON public.categories TO service_role;
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public read categories" ON public.categories FOR SELECT USING (true);
CREATE POLICY "admins manage categories" ON public.categories FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

-- Videos
CREATE TABLE public.videos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  description text,
  thumbnail_url text NOT NULL,
  video_url text NOT NULL,
  embed_code_backup text,
  category_id uuid REFERENCES public.categories(id) ON DELETE SET NULL,
  download_url text,
  download_enabled boolean NOT NULL DEFAULT false,
  popunder_url text,
  ads_enabled boolean NOT NULL DEFAULT true,
  duration text,
  views bigint NOT NULL DEFAULT 0,
  likes int NOT NULL DEFAULT 0,
  dislikes int NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'active',
  is_featured boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.videos TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.videos TO authenticated;
GRANT ALL ON public.videos TO service_role;
ALTER TABLE public.videos ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public read active videos" ON public.videos FOR SELECT USING (status='active' OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "admins manage videos" ON public.videos FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE INDEX videos_category_idx ON public.videos(category_id);
CREATE INDEX videos_created_idx ON public.videos(created_at DESC);
CREATE INDEX videos_views_idx ON public.videos(views DESC);
CREATE UNIQUE INDEX videos_video_url_unique ON public.videos (video_url) WHERE video_url IS NOT NULL;

-- Comments
CREATE TABLE public.comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  video_id uuid NOT NULL REFERENCES public.videos(id) ON DELETE CASCADE,
  username text NOT NULL,
  comment text NOT NULL,
  rating int NOT NULL DEFAULT 5 CHECK (rating BETWEEN 1 AND 5),
  likes int NOT NULL DEFAULT 0,
  has_link boolean NOT NULL DEFAULT false,
  is_fake boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'approved',
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.comments TO anon, authenticated;
GRANT UPDATE, DELETE ON public.comments TO authenticated;
GRANT ALL ON public.comments TO service_role;
ALTER TABLE public.comments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public read approved comments" ON public.comments FOR SELECT USING (status='approved' OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "anyone can post comments" ON public.comments
  FOR INSERT TO anon, authenticated
  WITH CHECK (
    length(btrim(comment)) > 0 AND length(btrim(username)) > 0
    AND length(comment) <= 2000 AND length(username) <= 80
    AND is_fake = false AND status = 'approved' AND video_id IS NOT NULL
  );
CREATE POLICY "admins manage comments" ON public.comments FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

-- Ads
CREATE TABLE public.ads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  position text NOT NULL UNIQUE,
  ad_code text,
  popunder_url text,
  once_per_user boolean NOT NULL DEFAULT true,
  is_active boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.ads TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.ads TO authenticated;
GRANT ALL ON public.ads TO service_role;
ALTER TABLE public.ads ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public read active ads" ON public.ads FOR SELECT USING (is_active = true);
CREATE POLICY "admins manage ads" ON public.ads FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

-- Menus
CREATE TABLE public.menus (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  url text NOT NULL,
  icon text,
  sort_order int NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.menus TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.menus TO authenticated;
GRANT ALL ON public.menus TO service_role;
ALTER TABLE public.menus ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public read menus" ON public.menus FOR SELECT USING (true);
CREATE POLICY "admins manage menus" ON public.menus FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

-- Settings (singleton)
CREATE TABLE public.settings (
  id int PRIMARY KEY DEFAULT 1 CHECK (id=1),
  site_status boolean NOT NULL DEFAULT true,
  site_title text NOT NULL DEFAULT 'StreamBD',
  site_description text NOT NULL DEFAULT 'Professional video streaming platform',
  maintenance_title text NOT NULL DEFAULT 'We will be back soon',
  maintenance_message text NOT NULL DEFAULT 'Our team is working hard to bring StreamBD back online.',
  animation_particles boolean NOT NULL DEFAULT true,
  animation_gradient boolean NOT NULL DEFAULT true,
  animation_floating_icons boolean NOT NULL DEFAULT true,
  seo_auto_meta boolean NOT NULL DEFAULT true,
  seo_auto_sitemap boolean NOT NULL DEFAULT true,
  seo_social_preview boolean NOT NULL DEFAULT true,
  dark_mode_default boolean NOT NULL DEFAULT true,
  default_language text NOT NULL DEFAULT 'English',
  favicon_url TEXT,
  telegram_bot_username TEXT NOT NULL DEFAULT 'vipdesi_bot',
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.settings TO anon, authenticated;
GRANT UPDATE ON public.settings TO authenticated;
GRANT ALL ON public.settings TO service_role;
ALTER TABLE public.settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public read settings" ON public.settings FOR SELECT USING (true);
CREATE POLICY "admins update settings" ON public.settings FOR UPDATE TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
INSERT INTO public.settings (id) VALUES (1);

-- Fake settings (singleton)
CREATE TABLE public.fake_settings (
  id int PRIMARY KEY DEFAULT 1 CHECK (id=1),
  enable_fake_likes boolean NOT NULL DEFAULT true,
  like_multiplier int NOT NULL DEFAULT 5,
  random_variation boolean NOT NULL DEFAULT true,
  enable_fake_comments boolean NOT NULL DEFAULT true,
  fake_comments_per_video int NOT NULL DEFAULT 5,
  mix_ratio int NOT NULL DEFAULT 70,
  auto_star_rating boolean NOT NULL DEFAULT true,
  random_usernames boolean NOT NULL DEFAULT true,
  random_timestamps boolean NOT NULL DEFAULT true,
  templates text NOT NULL DEFAULT E'Great video!\nLoved this content\nAmazing quality\nWorth watching\nKeep it up\nBest one so far\nThanks for sharing\nReally enjoyed it',
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, UPDATE ON public.fake_settings TO authenticated;
GRANT ALL ON public.fake_settings TO service_role;
ALTER TABLE public.fake_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins read fake_settings" ON public.fake_settings FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "admins update fake" ON public.fake_settings FOR UPDATE TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
INSERT INTO public.fake_settings (id) VALUES (1);

-- Reports
CREATE TABLE public.reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  video_id uuid REFERENCES public.videos(id) ON DELETE CASCADE,
  reason text NOT NULL,
  details text,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT INSERT ON public.reports TO anon, authenticated;
GRANT SELECT, UPDATE, DELETE ON public.reports TO authenticated;
GRANT ALL ON public.reports TO service_role;
ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anyone insert reports" ON public.reports
  FOR INSERT TO anon, authenticated
  WITH CHECK (
    length(btrim(reason)) > 0 AND length(reason) <= 200
    AND (details IS NULL OR length(details) <= 2000) AND status = 'pending'
  );
CREATE POLICY "admins manage reports" ON public.reports FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

-- Notifications
CREATE TABLE public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  message text NOT NULL,
  is_read boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.notifications TO authenticated;
GRANT ALL ON public.notifications TO service_role;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins manage notifications" ON public.notifications FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

-- Social links
CREATE TABLE public.social_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  platform text NOT NULL,
  url text NOT NULL,
  icon text NOT NULL DEFAULT 'Link',
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.social_links TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.social_links TO authenticated;
GRANT ALL ON public.social_links TO service_role;
ALTER TABLE public.social_links ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public read active social links" ON public.social_links FOR SELECT USING (is_active = true OR public.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "admins manage social links" ON public.social_links FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'::app_role)) WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

-- Subscription plans
CREATE TABLE public.subscription_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  duration_months INT NOT NULL,
  price NUMERIC(10,2) NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'BDT',
  is_active BOOLEAN NOT NULL DEFAULT true,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.subscription_plans TO anon, authenticated;
GRANT ALL ON public.subscription_plans TO service_role;
ALTER TABLE public.subscription_plans ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public read active plans" ON public.subscription_plans FOR SELECT TO anon, authenticated USING (is_active = true OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "admins manage plans" ON public.subscription_plans FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE TRIGGER plans_touch BEFORE UPDATE ON public.subscription_plans FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Hero slides
CREATE TABLE public.hero_slides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  subtitle TEXT,
  image_url TEXT NOT NULL,
  link_url TEXT,
  video_id UUID REFERENCES public.videos(id) ON DELETE SET NULL,
  sort_order INT NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.hero_slides TO anon, authenticated;
GRANT ALL ON public.hero_slides TO service_role;
ALTER TABLE public.hero_slides ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public read active slides" ON public.hero_slides FOR SELECT TO anon, authenticated USING (is_active = true OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "admins manage slides" ON public.hero_slides FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE TRIGGER slides_touch BEFORE UPDATE ON public.hero_slides FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Increment view counter
CREATE OR REPLACE FUNCTION public.increment_video_views(_video_id uuid)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$ UPDATE public.videos SET views = views + 1 WHERE id = _video_id $$;
GRANT EXECUTE ON FUNCTION public.increment_video_views(uuid) TO anon, authenticated;

-- Seeds
INSERT INTO public.categories (name, slug, sort_order) VALUES
  ('Action', 'action', 1), ('Drama', 'drama', 2), ('Comedy', 'comedy', 3),
  ('Music', 'music', 4), ('Sports', 'sports', 5), ('Documentary', 'documentary', 6);
INSERT INTO public.ads (position, is_active) VALUES
  ('header', false), ('sidebar', false), ('mid', false), ('footer', false), ('popunder', false);
INSERT INTO public.menus (name, url, icon, sort_order) VALUES
  ('Home','/','Home',1),('Trending','/trending','TrendingUp',2),('Categories','/categories','Grid',3);
INSERT INTO public.social_links (platform, url, icon, sort_order) VALUES
  ('Facebook', 'https://facebook.com', 'Facebook', 1),
  ('Twitter', 'https://twitter.com', 'Twitter', 2),
  ('Instagram', 'https://instagram.com', 'Instagram', 3),
  ('YouTube', 'https://youtube.com', 'Youtube', 4);
INSERT INTO public.subscription_plans (name, duration_months, price, sort_order) VALUES
  ('1 Month', 1, 200, 1), ('3 Months', 3, 500, 2), ('1 Year', 12, 1500, 3);
INSERT INTO public.profiles (user_id, username, display_name)
SELECT id, split_part(email,'@',1), split_part(email,'@',1) FROM auth.users
ON CONFLICT DO NOTHING;