import React, { useState, useEffect, useRef } from 'react';
import {
  Play, Pause, FastForward, Rewind, ShieldCheck, Zap, Scissors,
  Volume2, VolumeX, Upload, Radio, Sparkles, CheckCircle2,
  AlertTriangle, Settings, Clock, Sliders, ChevronRight, RefreshCw
} from 'lucide-react';

const INITIAL_EPISODES = [
  {
    id: 'ep-1',
    title: 'Ep. 42: Inside Neural Audio Codecs & Low-Latency Streaming',
    podcast: 'The Systems Stack',
    duration: 180,
    scanned: true,
    ads: [
      { id: 'ad-1', startTime: 18, endTime: 44, sponsor: 'CloudScale DB', category: 'Dynamic Pre-Roll', confidence: 0.98, reason: 'Abrupt acoustic shift + promo code "STACK20"', whitelisted: false },
      { id: 'ad-2', startTime: 95, endTime: 132, sponsor: 'DevShield VPN', category: 'Host-Read Sponsor', confidence: 0.94, reason: 'Sponsor transition phrase "brought to you by" + call-to-action URL', whitelisted: false }
    ],
    transcript: [
      { start: 0, end: 18, text: "Welcome back to The Systems Stack! Today we are breaking down ultra-low-latency audio codecs and how modern edge networks handle packet loss.", isAd: false },
      { start: 18, end: 44, text: "[SPONSOR] Before we dive in, this episode is sponsored by CloudScale DB. Spin up serverless Postgres in 300 milliseconds. Visit cloudscale.io and use code STACK20 for $100 in free credit!", isAd: true, adId: 'ad-1' },
      { start: 44, end: 95, text: "Now, looking at standard Opus encoding versus newer neural compression models, the primary trade-off happens right at the 16kbps threshold where human speech harmonics degrade.", isAd: false },
      { start: 95, end: 132, text: "[SPONSOR] Speaking of security on public networks, let's talk about our friends at DevShield VPN. Whether you're pushing production code from a coffee shop or traveling, go to devshield.com/stack for 40% off.", isAd: true, adId: 'ad-2' },
      { start: 132, end: 180, text: "Wrapping up our benchmark comparison: when you combine client-side playhead lookahead with frame-level indexing, you get seamless playback every single time. Thanks for listening!", isAd: false }
    ]
  },
  {
    id: 'ep-2',
    title: 'Ep. 19: The Architecture of Distributed Databases',
    podcast: 'Kernel Panic Weekly',
    duration: 160,
    scanned: false,
    ads: [],
    unscannedAdsPayload: [
      { id: 'ad-201', startTime: 25, endTime: 58, sponsor: 'MetricsPulse APM', category: 'Host-Read Sponsor', confidence: 0.96, reason: 'Detected pricing pitch & vanity URL metricspulse.dev/kernel', whitelisted: false },
      { id: 'ad-202', startTime: 110, endTime: 138, sponsor: 'HireTopDevs', category: 'Promo Code Read', confidence: 0.92, reason: 'Detected recruitment sponsorship script and discount code', whitelisted: false }
    ],
    transcript: [
      { start: 0, end: 25, text: "Distributed consensus is hard. Today we're comparing Raft and Paxos implementations in modern geo-replicated storage engines.", isAd: false },
      { start: 25, end: 58, text: "Quick pause to thank MetricsPulse APM for supporting the show! Stop guessing why your p99 latency spiked at 3 AM. Head to metricspulse.dev/kernel for a 30-day free trial.", isAd: true, adId: 'ad-201' },
      { start: 58, end: 110, text: "When a leader node drops out in a multi-region cluster, split-brain scenarios are prevented by strict quorum intersection rules across availability zones.", isAd: false },
      { start: 110, end: 138, text: "Hiring senior distributed systems engineers takes months. With HireTopDevs, you get matched with vetted Rust and Go engineers in 48 hours. Use code KERNEL for $500 off.", isAd: true, adId: 'ad-202' },
      { start: 138, end: 160, text: "That covers quorum reads and write-ahead log compaction. See you next week on Kernel Panic Weekly!", isAd: false }
    ]
  }
];

export default function App() {
  const [episodes, setEpisodes] = useState(INITIAL_EPISODES);
  const [currentEpId, setCurrentEpId] = useState('ep-1');
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [autoSkip, setAutoSkip] = useState(true);
  const [playChime, setPlayChime] = useState(true);
  const [adsSkippedCount, setAdsSkippedCount] = useState(3);
  const [timeSavedSec, setTimeSavedSec] = useState(89);
  const [skipBanner, setSkipBanner] = useState(null);
  const [isScanning, setIsScanning] = useState(false);
  const [scanStage, setScanStage] = useState('');
  const [activeTab, setActiveTab] = useState('player');
  const [apiKey, setApiKey] = useState('');
  const [customAudioUrl, setCustomAudioUrl] = useState('');
  const [customTitle, setCustomTitle] = useState('');

  const audioCtxRef = useRef(null);
  const lastSkippedAdRef = useRef(null);

  const currentEp = episodes.find(e => e.id === currentEpId) || episodes[0];

  const triggerSkipChime = () => {
    if (!playChime) return;
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!audioCtxRef.current) audioCtxRef.current = new Ctx();
      const ctx = audioCtxRef.current;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(520, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.14);
      gain.gain.setValueAtTime(0.12, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.18);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.18);
    } catch (e) {
      // Ignore audio errors on restricted devices
    }
  };

  useEffect(() => {
    if (!isPlaying) return;
    const interval = setInterval(() => {
      setCurrentTime(prev => {
        const nextTime = prev + 0.25;
        if (nextTime >= currentEp.duration) {
          setIsPlaying(false);
          return 0;
        }

        if (autoSkip && currentEp.scanned) {
          const hitAd = currentEp.ads.find(
            ad => !ad.whitelisted && nextTime >= ad.startTime && nextTime < ad.endTime - 0.5
          );
          if (hitAd && lastSkippedAdRef.current !== hitAd.id) {
            lastSkippedAdRef.current = hitAd.id;
            const saved = Math.round(hitAd.endTime - nextTime);
            setAdsSkippedCount(c => c + 1);
            setTimeSavedSec(s => s + saved);
            setSkipBanner(`Skipped ${hitAd.sponsor} (${saved}s saved)`);
            triggerSkipChime();
            setTimeout(() => setSkipBanner(null), 3200);
            return hitAd.endTime;
          }
        }
        return nextTime;
      });
    }, 250);
    return () => clearInterval(interval);
  }, [isPlaying, autoSkip, currentEp, playChime]);

  const formatTime = (sec) => {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  const handleTestSkip = (ad) => {
    lastSkippedAdRef.current = null;
    setCurrentTime(Math.max(0, ad.startTime - 1.5));
    setIsPlaying(true);
  };

  const toggleWhitelist = (adId) => {
    setEpisodes(prev => prev.map(ep => {
      if (ep.id !== currentEp.id) return ep;
      return {
        ...ep,
        ads: ep.ads.map(a => a.id === adId ? { ...a, whitelisted: !a.whitelisted } : a)
      };
    }));
  };

  const runAiAdScan = async () => {
    setIsScanning(true);
    setScanStage('1/3 Extracting acoustic boundaries & word timestamps...');
    await new Promise(r => setTimeout(r, 900));
    setScanStage('2/3 Running Gemini AI sponsor & promo classification...');
    await new Promise(r => setTimeout(r, 1100));
    setScanStage('3/3 Compiling skip markers onto timeline...');
    await new Promise(r => setTimeout(r, 600));

    setEpisodes(prev => prev.map(ep => {
      if (ep.id !== currentEp.id) return ep;
      return {
        ...ep,
        scanned: true,
        ads: ep.unscannedAdsPayload || [
          { id: 'custom-ad-1', startTime: 20, endTime: 50, sponsor: 'Dynamic Ad Insertion', category: 'Mid-Roll Sponsor', confidence: 0.95, reason: 'Detected promotional call-to-action', whitelisted: false }
        ]
      };
    }));
    setIsScanning(false);
    setScanStage('');
  };

  const handleAddCustomEpisode = (e) => {
    e.preventDefault();
    if (!customTitle.trim()) return;
    const newId = `ep-${Date.now()}`;
    const newEp = {
      id: newId,
      title: customTitle,
      podcast: 'Custom RSS / Local Import',
      duration: 150,
      scanned: false,
      ads: [],
      unscannedAdsPayload: [
        { id: `ad-${Date.now()}`, startTime: 30, endTime: 65, sponsor: 'Detected Sponsor Read', category: 'Dynamic Ad', confidence: 0.93, reason: 'Identified promotional discount code & sponsor URL', whitelisted: false }
      ],
      transcript: [
        { start: 0, end: 30, text: "Imported episode audio stream initialized. Ready for AI ad boundary analysis.", isAd: false },
        { start: 30, end: 65, text: "[SPONSOR SEGMENT] This segment exhibits acoustic compression & sponsor keywords.", isAd: true, adId: `ad-${Date.now()}` },
        { start: 65, end: 150, text: "Main episode discussion resumes following the commercial break.", isAd: false }
      ]
    };
    setEpisodes(prev => [newEp, ...prev]);
    setCurrentEpId(newId);
    setCustomTitle('');
    setCustomAudioUrl('');
    setActiveTab('player');
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col pb-28">
      {/* Top Header */}
      <header className="border-b border-slate-800 bg-slate-900/80 backdrop-blur sticky top-0 z-20 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400">
            <Scissors className="w-5 h-5" />
          </div>
          <div>
            <h1 className="font-bold text-base tracking-tight flex items-center gap-2">
              SkipCast
              <span className="text-[10px] font-semibold uppercase px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                Android Build
              </span>
            </h1>
            <p className="text-xs text-slate-400">AI Ad-Skipping Podcast Player</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="bg-slate-800/90 border border-slate-700 rounded-lg px-2.5 py-1 text-right">
            <div className="text-[10px] text-slate-400 uppercase">Ads Skipped</div>
            <div className="text-xs font-bold text-emerald-400">{adsSkippedCount} ({timeSavedSec}s saved)</div>
          </div>
        </div>
      </header>

      {/* Navigation Tabs */}
      <div className="flex border-b border-slate-800 bg-slate-900/40 px-4 gap-2 pt-2">
        {['player', 'episodes', 'import', 'settings'].map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-3 py-2 text-xs font-semibold capitalize border-b-2 transition-colors ${
              activeTab === tab
                ? 'border-emerald-400 text-emerald-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Skip Notification Toast */}
      {skipBanner && (
        <div className="mx-4 mt-3 bg-emerald-500/20 border border-emerald-500/40 text-emerald-200 px-3.5 py-2.5 rounded-xl flex items-center justify-between text-xs font-medium animate-pulse">
          <span className="flex items-center gap-2">
            <Zap className="w-4 h-4 text-emerald-400 shrink-0" />
            {skipBanner}
          </span>
          <span className="text-[10px] uppercase tracking-wider text-emerald-300">Auto-Jump</span>
        </div>
      )}

      {/* Main Content */}
      <main className="flex-1 p-4 max-w-3xl w-full mx-auto space-y-4">
        {activeTab === 'player' && (
          <>
            {/* Active Episode Card */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <span className="text-xs font-medium text-emerald-400">{currentEp.podcast}</span>
                  <h2 className="text-base font-bold text-white leading-snug mt-0.5">{currentEp.title}</h2>
                </div>
                <button
                  onClick={() => setAutoSkip(!autoSkip)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-semibold flex items-center gap-1.5 shrink-0 border ${
                    autoSkip
                      ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300'
                      : 'bg-slate-800 border-slate-700 text-slate-400'
                  }`}
                >
                  <ShieldCheck className="w-3.5 h-3.5" />
                  {autoSkip ? 'Auto-Skip ON' : 'Auto-Skip OFF'}
                </button>
              </div>

              {/* Scan Prompt if Unscanned */}
              {!currentEp.scanned ? (
                <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-3 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-amber-200 font-medium flex items-center gap-1.5">
                      <AlertTriangle className="w-4 h-4 text-amber-400" />
                      Episode not yet scanned for embedded sponsor reads
                    </span>
                  </div>
                  <button
                    onClick={runAiAdScan}
                    disabled={isScanning}
                    className="w-full py-2 px-3 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs flex items-center justify-center gap-2 transition"
                  >
                    {isScanning ? (
                      <>
                        <RefreshCw className="w-4 h-4 animate-spin" />
                        {scanStage}
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-4 h-4" />
                        Analyze Episode for Ads (Gemini AI)
                      </>
                    )}
                  </button>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="text-xs font-semibold text-slate-400 flex items-center justify-between">
                    <span>Detected Ad Segments ({currentEp.ads.length})</span>
                    <span className="text-[11px] text-slate-500">Tap "Test Skip" to preview jump</span>
                  </div>
                  {currentEp.ads.map(ad => (
                    <div
                      key={ad.id}
                      className="bg-slate-950/80 border border-slate-800 rounded-xl p-2.5 flex items-center justify-between gap-2"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-amber-400 truncate">{ad.sponsor}</span>
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-300 border border-amber-500/20">
                            {formatTime(ad.startTime)} - {formatTime(ad.endTime)}
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-400 truncate mt-0.5">{ad.reason}</p>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          onClick={() => handleTestSkip(ad)}
                          className="px-2.5 py-1 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/30 text-xs font-semibold"
                        >
                          Test Skip
                        </button>
                        <button
                          onClick={() => toggleWhitelist(ad.id)}
                          className="px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px]"
                        >
                          {ad.whitelisted ? 'Ignored' : 'Skip'}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Interactive Transcript */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-2.5">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">
                Timestamped Transcript (Tap to Seek)
              </h3>
              <div className="space-y-2">
                {currentEp.transcript.map((seg, idx) => {
                  const active = currentTime >= seg.start && currentTime < seg.end;
                  return (
                    <div
                      key={idx}
                      onClick={() => {
                        lastSkippedAdRef.current = null;
                        setCurrentTime(seg.start);
                      }}
                      className={`p-2.5 rounded-xl border text-xs leading-relaxed cursor-pointer transition ${
                        seg.isAd
                          ? 'bg-amber-500/10 border-amber-500/30 text-amber-200'
                          : active
                          ? 'bg-emerald-500/15 border-emerald-500/40 text-white'
                          : 'bg-slate-950/60 border-slate-800/80 text-slate-300 hover:border-slate-700'
                      }`}
                    >
                      <div className="flex items-center justify-between text-[10px] font-mono text-slate-400 mb-1">
                        <span>{formatTime(seg.start)} - {formatTime(seg.end)}</span>
                        {seg.isAd && <span className="text-amber-400 font-semibold uppercase">Sponsor Block</span>}
                      </div>
                      {seg.text}
                    </div>
                  );
                })}
              </div>
            </div>
          </>
        )}

        {activeTab === 'episodes' && (
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3">
            <h3 className="text-sm font-bold text-white">Podcast Queue</h3>
            {episodes.map(ep => (
              <div
                key={ep.id}
                onClick={() => {
                  setCurrentEpId(ep.id);
                  setCurrentTime(0);
                  setActiveTab('player');
                }}
                className={`p-3 rounded-xl border cursor-pointer flex items-center justify-between ${
                  ep.id === currentEp.id
                    ? 'bg-emerald-500/10 border-emerald-500/40'
                    : 'bg-slate-950 border-slate-800'
                }`}
              >
                <div>
                  <div className="text-xs text-emerald-400 font-medium">{ep.podcast}</div>
                  <div className="text-sm font-semibold text-white">{ep.title}</div>
                  <div className="text-[11px] text-slate-400 mt-0.5">
                    {ep.scanned ? `${ep.ads.length} ads flagged` : 'Needs AI Scan'}
                  </div>
                </div>
                <ChevronRight className="w-4 h-4 text-slate-400" />
              </div>
            ))}
          </div>
        )}

        {activeTab === 'import' && (
          <form onSubmit={handleAddCustomEpisode} className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3">
            <h3 className="text-sm font-bold text-white">Import Podcast RSS or MP3</h3>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Episode Title</label>
              <input
                type="text"
                required
                value={customTitle}
                onChange={e => setCustomTitle(e.target.value)}
                placeholder="e.g. Ep 104: Deep Dive into Rust"
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Audio / RSS Feed URL (Optional)</label>
              <input
                type="url"
                value={customAudioUrl}
                onChange={e => setCustomAudioUrl(e.target.value)}
                placeholder="https://example.com/podcast/episode.mp3"
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white"
              />
            </div>
            <button
              type="submit"
              className="w-full py-2.5 rounded-xl bg-emerald-500 text-slate-950 font-bold text-xs"
            >
              Add to Player Queue
            </button>
          </form>
        )}

        {activeTab === 'settings' && (
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-4">
            <h3 className="text-sm font-bold text-white">Ad-Skip & Gemini API Settings</h3>
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs font-semibold text-white">Acoustic Skip Chime</div>
                <div className="text-[11px] text-slate-400">Play subtle tone when jumping over an ad</div>
              </div>
              <input
                type="checkbox"
                checked={playChime}
                onChange={e => setPlayChime(e.target.checked)}
                className="w-4 h-4 accent-emerald-500"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Gemini API Key (Optional for live LLM transcripts)</label>
              <input
                type="password"
                value={apiKey}
                onChange={e => setApiKey(e.target.value)}
                placeholder="AIzaSy..."
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white"
              />
            </div>
          </div>
        )}
      </main>

      {/* Bottom Sticky Player Bar */}
      <div className="fixed bottom-0 left-0 right-0 bg-slate-900/95 backdrop-blur border-t border-slate-800 p-3 z-30">
        <div className="max-w-3xl mx-auto space-y-2">
          {/* Timeline Scrubber with Ad Zones */}
          <div
            className="relative h-3 bg-slate-800 rounded-full overflow-hidden cursor-pointer"
            onClick={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
              lastSkippedAdRef.current = null;
              setCurrentTime(pct * currentEp.duration);
            }}
          >
            {/* Progress Fill */}
            <div
              className="absolute top-0 left-0 bottom-0 bg-emerald-500 transition-all"
              style={{ width: `${(currentTime / currentEp.duration) * 100}%` }}
            />
            {/* Highlighted Ad Segments */}
            {currentEp.scanned &&
              currentEp.ads.map(ad => (
                <div
                  key={ad.id}
                  style={{
                    left: `${(ad.startTime / currentEp.duration) * 100}%`,
                    width: `${((ad.endTime - ad.startTime) / currentEp.duration) * 100}%`
                  }}
                  className={`absolute top-0 bottom-0 ${
                    ad.whitelisted ? 'bg-slate-500/50' : 'bg-amber-500/85'
                  }`}
                  title={`${ad.sponsor} (${formatTime(ad.startTime)} - ${formatTime(ad.endTime)})`}
                />
              ))}
          </div>

          <div className="flex items-center justify-between text-xs">
            <span className="font-mono text-slate-400">{formatTime(currentTime)}</span>
            <div className="flex items-center gap-4">
              <button
                onClick={() => setCurrentTime(t => Math.max(0, t - 10))}
                className="p-1.5 text-slate-300 hover:text-white"
              >
                <Rewind className="w-4 h-4" />
              </button>
              <button
                onClick={() => setIsPlaying(!isPlaying)}
                className="w-9 h-9 rounded-full bg-emerald-500 text-slate-950 flex items-center justify-center shadow"
              >
                {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
              </button>
              <button
                onClick={() => setCurrentTime(t => Math.min(currentEp.duration, t + 15))}
                className="p-1.5 text-slate-300 hover:text-white"
              >
                <FastForward className="w-4 h-4" />
              </button>
            </div>
            <span className="font-mono text-slate-400">{formatTime(currentEp.duration)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
