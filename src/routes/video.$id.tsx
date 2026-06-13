import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { SiteLayout } from "@/components/site/SiteLayout";
import { VideoCard, type VideoCardData } from "@/components/site/VideoCard";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Play, ThumbsUp, ThumbsDown, Share2, Bookmark, Download, Flag, Star } from "lucide-react";
import { formatViews, timeAgo, containsLink } from "@/lib/format";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useServerFn } from "@tanstack/react-start";
import { incrementVideoView } from "@/lib/admin-users.functions";
import { getVideoEngagement } from "@/lib/engagement.functions";
import { getMyStatus, selfRestrict } from "@/lib/restrict.functions";
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogAction } from "@/components/ui/alert-dialog";

export const Route = createFileRoute("/video/$id")({
  head: ({ params }) => ({
    meta: [
      { title: "Watch — StreamBD" },
      { property: "og:title", content: "Watch on StreamBD" },
      { property: "og:type", content: "video.other" },
      { property: "og:url", content: `/video/${params.id}` },
    ],
    links: [{ rel: "canonical", href: `/video/${params.id}` }],
  }),
  component: VideoPage,
});

function Stars({ value, onChange }: { value: number; onChange?: (n: number) => void }) {
  return (
    <div className="flex gap-1">
      {[1,2,3,4,5].map(n => (
        <button key={n} type="button" onClick={() => onChange?.(n)} disabled={!onChange}>
          <Star className={`h-4 w-4 ${n<=value?"fill-primary text-primary":"text-muted-foreground"}`} />
        </button>
      ))}
    </div>
  );
}

function hasActiveSubscription(profile: any) {
  return profile?.plan === "paid" && (!profile.plan_expires_at || new Date(profile.plan_expires_at) > new Date());
}

function PlayerAdFrame({ adCode }: { adCode?: string | null }) {
  if (!adCode) {
    return <div className="text-sm text-muted-foreground">Advertisement loading...</div>;
  }

  return (
    <iframe
      title="Player advertisement"
      srcDoc={adCode}
      sandbox="allow-scripts allow-popups allow-forms allow-top-navigation-by-user-activation"
      className="h-full w-full border-0 bg-background"
    />
  );
}

function VideoPage() {
  const { id } = Route.useParams();
  const [video, setVideo] = useState<any>(null);
  const [related, setRelated] = useState<VideoCardData[]>([]);
  const [comments, setComments] = useState<any[]>([]);
  const [displayLikes, setDisplayLikes] = useState<number>(0);
  const [displayComments, setDisplayComments] = useState<any[]>([]);
  const [showPlayer, setShowPlayer] = useState(false);
  const [showDesc, setShowDesc] = useState(false);
  const [commentText, setCommentText] = useState("");
  const [commentRating, setCommentRating] = useState(5);
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [replyText, setReplyText] = useState("");
  const [myCommentLikes, setMyCommentLikes] = useState<Set<string>>(new Set());
  const [myVideoLike, setMyVideoLike] = useState(false);
  const [profileName, setProfileName] = useState<string>("");
  const [reportReason, setReportReason] = useState("Broken Video");
  const [userId, setUserId] = useState<string | null>(null);
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [playerAds, setPlayerAds] = useState<any[]>([]);
  const [showAdGate, setShowAdGate] = useState(false);
  const [activePlayerAd, setActivePlayerAd] = useState<any | null>(null);
  const incView = useServerFn(incrementVideoView);
  const fetchEngagement = useServerFn(getVideoEngagement);
  const fetchMyStatus = useServerFn(getMyStatus);
  const doSelfRestrict = useServerFn(selfRestrict);
  const [restricted, setRestricted] = useState(false);
  const [showRestricted, setShowRestricted] = useState(false);

  useEffect(() => {
    (async () => {
      setVideo(null);
      setShowPlayer(false);
      setShowAdGate(false);
      setActivePlayerAd(null);
      setIsSubscribed(false);
      setPlayerAds([]);
      try {
        const s = await fetchMyStatus();
        if (s.status === "restricted" || s.status === "banned") {
          setRestricted(true);
          setShowRestricted(true);
          return;
        }
      } catch {}
      const { data: v } = await supabase.from("videos").select("*").eq("id", id).maybeSingle();
      const { data: authData } = await supabase.auth.getUser();
      const currentUserId = authData.user?.id ?? null;
      setUserId(currentUserId);

      let subscribed = false;
      if (currentUserId) {
        const { data: profile } = await (supabase as any)
          .from("profiles")
          .select("plan,plan_expires_at")
          .eq("user_id", currentUserId)
          .maybeSingle();
        subscribed = hasActiveSubscription(profile);
        setIsSubscribed(subscribed);
      }

      if (v?.ads_enabled && !subscribed) {
        const { data: ads } = await supabase
          .from("ads")
          .select("position,ad_code,popunder_url,once_per_user,is_active")
          .in("position", ["mid", "popunder"]);
        setPlayerAds(ads ?? []);
      }
      setVideo(v);
      if (v) {
        incView({ data: { videoId: id } }).catch(() => {});
        const hist: string[] = JSON.parse(localStorage.getItem("history") ?? "[]");
        localStorage.setItem("history", JSON.stringify([id, ...hist.filter(x=>x!==id)].slice(0,50)));
        if (v.category_id) {
          const { data: rel } = await supabase.from("videos").select("id,title,thumbnail_url,views,duration,created_at").eq("status","active").eq("category_id", v.category_id).neq("id", id).limit(8);
          setRelated(rel ?? []);
        }
      }
      const { data: c } = await supabase.from("comments").select("*").eq("video_id", id).eq("status","approved").order("created_at",{ascending:false}).limit(100);
      setComments(c ?? []);
      try {
        const eng = await fetchEngagement({ data: { videoId: id } });
        setDisplayLikes(eng.displayLikes);
        setDisplayComments(eng.displayComments);
      } catch {
        setDisplayLikes(v?.likes ?? 0);
        setDisplayComments(c ?? []);
      }
      // Load current-user signals: profile name + own likes
      if (currentUserId) {
        const [{ data: prof }, { data: myVL }, { data: myCL }] = await Promise.all([
          (supabase as any).from("profiles").select("username,display_name").eq("user_id", currentUserId).maybeSingle(),
          (supabase as any).from("video_likes").select("id").eq("video_id", id).eq("user_id", currentUserId).maybeSingle(),
          (supabase as any).from("comment_likes").select("comment_id").eq("user_id", currentUserId),
        ]);
        setProfileName(prof?.display_name || prof?.username || "");
        setMyVideoLike(!!myVL);
        setMyCommentLikes(new Set((myCL ?? []).map((r: any) => r.comment_id)));
      } else {
        setProfileName("");
        setMyVideoLike(false);
        setMyCommentLikes(new Set());
      }
    })();
  }, [id]);

  const handlePlay = () => {
    if (restricted) { setShowRestricted(true); return; }
    if (!video) return;
    const shouldShowAds = video.ads_enabled && !isSubscribed;
    const viewerKey = userId ?? "guest";
    const playerAdKey = `player_ad_shown:${viewerKey}:${id}`;

    if (shouldShowAds && !localStorage.getItem(playerAdKey)) {
      const playerAd = playerAds.find(a => a.position === "mid" && a.ad_code) ?? playerAds.find(a => a.ad_code);
      if (playerAd) {
        localStorage.setItem(playerAdKey, "1");
        setActivePlayerAd(playerAd);
        setShowAdGate(true);
        return;
      }

      const popunderUrl = playerAds.find(a => a.position === "popunder")?.popunder_url ?? video.popunder_url;
      if (popunderUrl) {
        localStorage.setItem(playerAdKey, "1");
        window.open(popunderUrl, "_blank");
      }
    }
    setShowPlayer(true);
  };

  const continueToVideo = () => {
    setShowAdGate(false);
    setShowPlayer(true);
  };

  const saveLater = () => {
    const ids: string[] = JSON.parse(localStorage.getItem("watch_later") ?? "[]");
    if (!ids.includes(id)) {
      localStorage.setItem("watch_later", JSON.stringify([id, ...ids]));
      toast.success("Added to Watch Later");
    } else toast("Already saved");
  };

  const share = (platform: "fb"|"wa"|"copy") => {
    const url = window.location.href;
    if (platform==="fb") window.open(`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`, "_blank");
    if (platform==="wa") window.open(`https://wa.me/?text=${encodeURIComponent((video?.title??"")+" "+url)}`, "_blank");
    if (platform==="copy") { navigator.clipboard.writeText(url); toast.success("Link copied"); }
  };

  const postComment = async (parentId: string | null = null, text?: string) => {
    if (restricted) { setShowRestricted(true); return; }
    if (!userId) { toast.error("Please sign in to comment"); return; }
    const body = (text ?? commentText).trim();
    if (!body) return toast.error("Write something first");
    const name = profileName || "User";
    const hasLink = containsLink(body);
    if (hasLink) {
      try { await doSelfRestrict(); } catch {}
      setRestricted(true);
      setShowRestricted(true);
      return;
    }
    const { error, data } = await (supabase as any).from("comments").insert({
      video_id: id, username: name, comment: body, rating: parentId ? 5 : commentRating, has_link: false, parent_id: parentId, user_id: userId,
    }).select().single();
    if (error) return toast.error(error.message);
    setComments([data, ...comments]);
    setDisplayComments([data, ...displayComments]);
    if (parentId) { setReplyTo(null); setReplyText(""); }
    else setCommentText("");
    toast.success(parentId ? "Reply posted" : "Comment posted");
  };

  const toggleCommentLike = async (commentId: string) => {
    if (!userId) return toast.error("Please sign in to like");
    const has = myCommentLikes.has(commentId);
    if (has) {
      await (supabase as any).from("comment_likes").delete().eq("comment_id", commentId).eq("user_id", userId);
      const next = new Set(myCommentLikes); next.delete(commentId); setMyCommentLikes(next);
      setDisplayComments(displayComments.map(c => c.id === commentId ? { ...c, likes: Math.max(0,(c.likes ?? 0) - 1) } : c));
    } else {
      const { error } = await (supabase as any).from("comment_likes").insert({ comment_id: commentId, user_id: userId });
      if (error) return toast.error(error.message);
      const next = new Set(myCommentLikes); next.add(commentId); setMyCommentLikes(next);
      setDisplayComments(displayComments.map(c => c.id === commentId ? { ...c, likes: (c.likes ?? 0) + 1 } : c));
    }
  };

  const toggleVideoLike = async () => {
    if (!userId) return toast.error("Please sign in to like");
    if (myVideoLike) {
      await (supabase as any).from("video_likes").delete().eq("video_id", id).eq("user_id", userId);
      setMyVideoLike(false);
      setDisplayLikes(l => Math.max(0, l - 1));
    } else {
      const { error } = await (supabase as any).from("video_likes").insert({ video_id: id, user_id: userId });
      if (error) return toast.error(error.message);
      setMyVideoLike(true);
      setDisplayLikes(l => l + 1);
    }
  };

  const submitReport = async () => {
    await supabase.from("reports").insert({ video_id: id, reason: reportReason });
    toast.success("Report submitted");
  };

  if (!video) return <SiteLayout requireAuth><div className="container mx-auto px-4 py-12 text-muted-foreground">Loading...</div></SiteLayout>;

  return (
    <SiteLayout requireAuth>
      <div className="container mx-auto px-4 py-6">
        <nav className="text-xs text-muted-foreground mb-4">
          <Link to="/" className="hover:text-foreground">Home</Link> &gt;{" "}
          <span className="text-foreground">{video.title}</span>
        </nav>

        <div className="grid lg:grid-cols-[1fr_320px] gap-6">
          <div>
            {/* Player */}
            <div className="relative bg-black rounded-xl overflow-hidden aspect-video border border-border">
              {!showPlayer ? showAdGate ? (
                <div className="absolute inset-0 flex flex-col bg-card">
                  <div className="min-h-0 flex-1 p-3">
                    <PlayerAdFrame adCode={activePlayerAd?.ad_code} />
                  </div>
                  <div className="flex items-center justify-between gap-3 border-t border-border bg-background/95 px-4 py-3">
                    <span className="text-sm font-medium text-muted-foreground">Advertisement</span>
                    <Button size="sm" onClick={continueToVideo}>Continue to video</Button>
                  </div>
                </div>
              ) : (
                <button onClick={handlePlay} className="absolute inset-0 group">
                  <img src={video.thumbnail_url} alt={video.title} className="absolute inset-0 w-full h-full object-cover" />
                  <div className="absolute inset-0 bg-black/40" />
                  <div className="relative h-full w-full flex flex-col items-center justify-center gap-3">
                    <div className="h-20 w-20 rounded-full bg-primary flex items-center justify-center shadow-glow animate-pulse-play">
                      <Play className="h-10 w-10 text-primary-foreground fill-current" />
                    </div>
                    <span className="text-sm text-white/90">Click to Play</span>
                  </div>
                </button>
              ) : (
                <iframe src={video.video_url} className="w-full h-full animate-fade-in" allowFullScreen frameBorder={0} />
              )}
            </div>

            <h1 className="text-2xl font-bold mt-4">{video.title}</h1>
            <div className="flex items-center gap-3 text-sm text-muted-foreground mt-2 flex-wrap">
              <span>{formatViews(video.views)} views</span>
              <span className="w-1 h-1 rounded-full bg-muted-foreground/50" />
              <span>{timeAgo(video.created_at)}</span>
              <Stars value={5} />
            </div>

            <div className="flex items-center gap-2 mt-4 flex-wrap">
              <Button variant={myVideoLike ? "default" : "outline"} size="sm" onClick={toggleVideoLike}><ThumbsUp className="h-4 w-4 mr-2" />{displayLikes}</Button>
              <Button variant="outline" size="sm"><ThumbsDown className="h-4 w-4 mr-2" />{video.dislikes ?? 0}</Button>

              <Dialog>
                <DialogTrigger asChild>
                  <Button variant="outline" size="sm"><Share2 className="h-4 w-4 mr-2" />Share</Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader><DialogTitle>Share this video</DialogTitle></DialogHeader>
                  <div className="flex gap-2">
                    <Button onClick={() => share("fb")} variant="outline">Facebook</Button>
                    <Button onClick={() => share("wa")} variant="outline">WhatsApp</Button>
                    <Button onClick={() => share("copy")}>Copy Link</Button>
                  </div>
                </DialogContent>
              </Dialog>

              <Button variant="outline" size="sm" onClick={saveLater}><Bookmark className="h-4 w-4 mr-2" />Watch Later</Button>
              {video.download_enabled && video.download_url && (
                <a href={video.download_url} target="_blank" rel="noreferrer"><Button variant="outline" size="sm"><Download className="h-4 w-4 mr-2" />Download</Button></a>
              )}
              <Dialog>
                <DialogTrigger asChild><Button variant="outline" size="sm"><Flag className="h-4 w-4 mr-2" />Report</Button></DialogTrigger>
                <DialogContent>
                  <DialogHeader><DialogTitle>Report video</DialogTitle></DialogHeader>
                  <Select value={reportReason} onValueChange={setReportReason}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {["Broken Video","Wrong Title","Spam","Copyright","Other"].map(r=><SelectItem key={r} value={r}>{r}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Button onClick={submitReport}>Submit report</Button>
                </DialogContent>
              </Dialog>
            </div>

            {video.description && (
              <div className="mt-6 bg-card border border-border rounded-xl p-4">
                <p className={showDesc ? "" : "line-clamp-3"}>{video.description}</p>
                <button onClick={()=>setShowDesc(s=>!s)} className="text-sm text-primary mt-2">{showDesc?"Show less":"Show more"}</button>
              </div>
            )}

            {/* Comments */}
            <section className="mt-8">
              <h2 className="text-lg font-bold mb-4">Comments ({displayComments.filter((c:any)=>!c.parent_id).length})</h2>
              {userId ? (
                <div className="bg-card border border-border rounded-xl p-4 mb-4 space-y-3">
                  <div className="text-xs text-muted-foreground">Posting as <strong>{profileName || "User"}</strong></div>
                  <Textarea value={commentText} onChange={e=>setCommentText(e.target.value)} placeholder="Write a comment..." />
                  <div className="flex items-center justify-between">
                    <Stars value={commentRating} onChange={setCommentRating} />
                    <Button onClick={() => postComment(null)} size="sm">Post comment</Button>
                  </div>
                </div>
              ) : (
                <div className="bg-card border border-border rounded-xl p-4 mb-4 text-sm text-muted-foreground">
                  <Link to="/auth" className="text-primary hover:underline">Sign in</Link> to like and post comments.
                </div>
              )}
              <div className="space-y-5">
                {displayComments.filter((c:any) => !c.parent_id).map((c:any) => {
                  const replies = displayComments.filter((r:any) => r.parent_id === c.id);
                  const liked = myCommentLikes.has(c.id);
                  return (
                    <div key={c.id} className={`flex gap-3 ${c.has_link?"opacity-70":""}`}>
                      <div className="h-10 w-10 rounded-full bg-primary/20 flex items-center justify-center text-sm font-semibold shrink-0">
                        {c.username.slice(0,2).toUpperCase()}
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center gap-2 text-sm">
                          <span className="font-semibold">{c.username}</span>
                          <span className="text-xs text-muted-foreground">{timeAgo(c.created_at)}</span>
                          <Stars value={c.rating} />
                        </div>
                        <p className={`text-sm mt-1 ${c.has_link?"text-destructive":""}`}>{c.comment}</p>
                        {!c._fake && (
                          <div className="flex items-center gap-3 mt-2 text-xs">
                            <button onClick={() => toggleCommentLike(c.id)} className={`inline-flex items-center gap-1 hover:text-primary ${liked?"text-primary":"text-muted-foreground"}`}>
                              <ThumbsUp className="h-3.5 w-3.5" /> {c.likes ?? 0}
                            </button>
                            <button onClick={() => { setReplyTo(replyTo === c.id ? null : c.id); setReplyText(""); }} className="text-muted-foreground hover:text-primary">
                              Reply
                            </button>
                          </div>
                        )}
                        {replyTo === c.id && userId && (
                          <div className="mt-2 space-y-2">
                            <Textarea value={replyText} onChange={e=>setReplyText(e.target.value)} placeholder={`Reply to ${c.username}...`} rows={2} />
                            <div className="flex gap-2 justify-end">
                              <Button size="sm" variant="outline" onClick={() => setReplyTo(null)}>Cancel</Button>
                              <Button size="sm" onClick={() => postComment(c.id, replyText)}>Reply</Button>
                            </div>
                          </div>
                        )}
                        {replies.length > 0 && (
                          <div className="mt-3 space-y-3 pl-4 border-l border-border">
                            {replies.map((r:any) => {
                              const rLiked = myCommentLikes.has(r.id);
                              return (
                                <div key={r.id} className="flex gap-2">
                                  <div className="h-8 w-8 rounded-full bg-primary/20 flex items-center justify-center text-xs font-semibold shrink-0">
                                    {r.username.slice(0,2).toUpperCase()}
                                  </div>
                                  <div className="flex-1">
                                    <div className="flex items-center gap-2 text-xs">
                                      <span className="font-semibold">{r.username}</span>
                                      <span className="text-muted-foreground">{timeAgo(r.created_at)}</span>
                                    </div>
                                    <p className="text-sm mt-1">{r.comment}</p>
                                    {!r._fake && (
                                      <button onClick={() => toggleCommentLike(r.id)} className={`mt-1 inline-flex items-center gap-1 text-xs hover:text-primary ${rLiked?"text-primary":"text-muted-foreground"}`}>
                                        <ThumbsUp className="h-3 w-3" /> {r.likes ?? 0}
                                      </button>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          </div>

          {/* Sidebar related */}
          <aside className="space-y-4">
            <h3 className="font-semibold">Related videos</h3>
            {related.map(v => <VideoCard key={v.id} v={v} />)}
          </aside>
        </div>
      </div>
      <AlertDialog open={showRestricted} onOpenChange={setShowRestricted}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-destructive">ID Restricted</AlertDialogTitle>
            <AlertDialogDescription>
              Your account has been restricted for posting links or violating community rules. You can no longer comment or watch videos. Contact admin to appeal.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction onClick={() => setShowRestricted(false)}>OK</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SiteLayout>
  );
}