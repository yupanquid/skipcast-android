import React, { useState, useEffect, useRef } from 'react';
import {
  Play, Pause, FastForward, Rewind, ShieldCheck, Zap, Scissors,
  Volume2, VolumeX, Sparkles, AlertTriangle, RefreshCw,
  Search, Download, CheckCircle2, Trash2, WifiOff, Rss,
  Plus, Check, FolderUp, FileDown, ArrowLeft, ListPlus, ChevronRight,
  ArrowUp, ArrowDown, ListX
} from 'lucide-react';

const getNativeMediaSession = () => window.Capacitor?.Plugins?.MediaSession || null;

const DEFAULT_ARTWORK = 'https://images.unsplash.com/photo-1590602847861-f357a9332bbc?w=512&q=80';

const INITIAL_EPISODES = [
  {
    id: 'ep-real-1',
    guid: 'somafm-test-1',
    title: 'SomaFM: Deep Space One (Live Ambient Stream Test)',
    podcast: 'Live Audio Stream Verification',
    audioUrl: 'https://ice1.somafm.com/deepspaceone-128-mp3',
    artwork: 'https://somafm.com/img3/deepspaceone-400.jpg',
    pubDate: new Date().toISOString(),
    duration: 3600,
    scanned: true,
    ads: [
      { id: 'ad-demo-1', startTime: 15, endTime: 35, sponsor: 'Test Ad Window (15s-35s)', category: 'Manual Test Segment', confidence: 0.98, reason: 'Tap "Test Skip" to verify skip jump on real audio', whitelisted: false }
    ],
    transcript: [
      { start: 0, end: 15, text: "Live MP3 stream connected. Press Play below to verify hardware audio output and Lock Screen Media Tile.", isAd: false },
      { start: 15, end: 35, text: "[TEST SPONSOR BLOCK] Auto-Skip will jump from 0:15 directly to 0:35 during playback.", isAd: true, adId: 'ad-demo-1' },
      { start: 35, end: 3600, text: "Clean audio stream continues.", isAd: false }
    ]
  }
];

const DB_NAME = 'SkipCastOfflineDB_v6';
const AUDIO_STORE = 'audioFiles';
const FEED_CACHE_STORE = 'showEpisodesCache';

const openAppDB = () => {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 2);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(AUDIO_STORE)) db.createObjectStore(AUDIO_STORE);
      if (!db.objectStoreNames.contains(FEED_CACHE_STORE)) db.createObjectStore(FEED_CACHE_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
};

const saveEpisodeBlob = async (epId, blob) => {
  const db = await openAppDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(AUDIO_STORE, 'readwrite');
    tx.objectStore(AUDIO_STORE).put(blob, epId);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
};

const getEpisodeBlob = async (epId) => {
  const db = await openAppDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(AUDIO_STORE, 'readonly');
    const req = tx.objectStore(AUDIO_STORE).get(epId);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
};

const deleteEpisodeBlob = async (epId) => {
  const db = await openAppDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(AUDIO_STORE, 'readwrite');
    tx.objectStore(AUDIO_STORE).delete(epId);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
};

const getAllOfflineKeys = async () => {
  const db = await openAppDB();
  return new Promise((resolve) => {
    const tx = db.transaction(AUDIO_STORE, 'readonly');
    const req = tx.objectStore(AUDIO_STORE).getAllKeys();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => resolve([]);
  });
};

const saveShowArchiveCache = async (feedUrl, episodesArray) => {
  try {
    const db = await openAppDB();
    return new Promise((resolve) => {
      const tx = db.transaction(FEED_CACHE_STORE, 'readwrite');
      tx.objectStore(FEED_CACHE_STORE).put(episodesArray, feedUrl.toLowerCase());
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
    });
  } catch (_) {}
};

const getShowArchiveCache = async (feedUrl) => {
  try {
    const db = await openAppDB();
    return new Promise((resolve) => {
      const tx = db.transaction(FEED_CACHE_STORE, 'readonly');
      const req = tx.objectStore(FEED_CACHE_STORE).get(feedUrl.toLowerCase());
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    });
  } catch (_) {
    return null;
  }
};

const fetchFeedXmlText = async (feedUrl) => {
  let xmlText = '';
  try {
    const r = await fetch(feedUrl);
    if (r.ok) xmlText = await r.text();
  } catch (_) {}

  if (!xmlText || (!xmlText.includes('<item') && !xmlText.includes('<entry'))) {
    try {
      const proxyUrl = `https://corsproxy.io/?${encodeURIComponent(feedUrl)}`;
      const r2 = await fetch(proxyUrl);
      if (r2.ok) xmlText = await r2.text();
    } catch (_) {}
  }

  if (!xmlText || (!xmlText.includes('<item') && !xmlText.includes('<entry'))) {
    try {
      const proxyUrl2 = `https://api.allorigins.win/get?url=${encodeURIComponent(feedUrl)}`;
      const r3 = await fetch(proxyUrl2);
      const data = await r3.json();
      xmlText = data.contents || '';
    } catch (_) {}
  }

  return xmlText;
};

const arrayBufferToBase64 = (buffer) => {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return window.btoa(binary);
};

// Fetch a byte range directly or via CORS proxy
const fetchAudioRange = async (audioUrl, startByte, endByte) => {
  const headers = { Range: `bytes=${startByte}-${endByte}` };
  try {
    const r = await fetch(audioUrl, { headers });
    if (r.ok || r.status === 206) {
      const contentRange = r.headers.get('content-range');
      let totalBytes = null;
      if (contentRange && contentRange.includes('/')) {
        const parsedTotal = Number(contentRange.split('/')[1]);
        if (!isNaN(parsedTotal) && parsedTotal > 0) totalBytes = parsedTotal;
      }
      const buffer = await r.arrayBuffer();
      if (buffer && buffer.byteLength > 10000) {
        return { buffer, totalBytes };
      }
    }
  } catch (_) {}

  try {
    const rProxy = await fetch(`https://corsproxy.io/?${encodeURIComponent(audioUrl)}`, { headers });
    if (rProxy.ok || rProxy.status === 206) {
      const contentRange = rProxy.headers.get('content-range');
      let totalBytes = null;
      if (contentRange && contentRange.includes('/')) {
        const parsedTotal = Number(contentRange.split('/')[1]);
        if (!isNaN(parsedTotal) && parsedTotal > 0) totalBytes = parsedTotal;
      }
      const buffer = await rProxy.arrayBuffer();
      if (buffer && buffer.byteLength > 10000) {
        return { buffer, totalBytes };
      }
    }
  } catch (_) {}

  return null;
};

// ACOUSTIC SILENCE SNAPPING: Finds the quietest pause within +/- 2.5s of targetSec
const snapToNearestSilence = async (audioBufferData, targetSec, chunkStartSec, searchRadiusSec = 2.5) => {
  if (!audioBufferData) return targetSec;
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    const ctx = new Ctx();
    const decoded = await ctx.decodeAudioData(audioBufferData.slice(0));
    const channelData = decoded.getChannelData(0);
    const sampleRate = decoded.sampleRate;
    const clipDuration = decoded.duration;

    const relTarget = targetSec - chunkStartSec;
    if (relTarget < 0 || relTarget > clipDuration) return targetSec;

    const startSearch = Math.max(0, relTarget - searchRadiusSec);
    const endSearch = Math.min(clipDuration, relTarget + searchRadiusSec);

    const windowSize = Math.floor(sampleRate * 0.05); // 50ms window
    let minRms = Infinity;
    let bestRelTime = relTarget;

    for (let t = startSearch; t < endSearch; t += 0.025) { // test every 25ms
      const startIndex = Math.floor(t * sampleRate);
      let sumSquares = 0;
      let count = 0;
      for (let i = 0; i < windowSize && (startIndex + i) < channelData.length; i++) {
        const val = channelData[startIndex + i];
        sumSquares += val * val;
        count++;
      }
      const rms = count > 0 ? Math.sqrt(sumSquares / count) : 0;
      if (rms < minRms) {
        minRms = rms;
        bestRelTime = t;
      }
    }
    ctx.close();
    return Math.round((chunkStartSec + bestRelTime) * 10) / 10;
  } catch (_) {
    return targetSec;
  }
};

export default function App() {
  const [episodes, setEpisodes] = useState(() => {
    try {
      const saved = localStorage.getItem('skipcast_episodes_v6');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch (_) {}
    return INITIAL_EPISODES;
  });

  const [subscriptions, setSubscriptions] = useState(() => {
    try {
      const saved = localStorage.getItem('skipcast_subscriptions_v5');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch (_) {}
    return [];
  });

  const [currentEpId, setCurrentEpId] = useState(() => {
    return localStorage.getItem('skipcast_active_ep') || INITIAL_EPISODES[0].id;
  });

  const [selectedPodcast, setSelectedPodcast] = useState(null);
  const [selectedPodcastEpisodes, setSelectedPodcastEpisodes] = useState([]);
  const [isLoadingShowEps, setIsLoadingShowEps] = useState(false);
  const [episodeFilterQuery, setEpisodeFilterQuery] = useState('');

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(1800);
  const [isMuted, setIsMuted] = useState(false);
  const [audioError, setAudioError] = useState(null);
  const [statusToast, setStatusToast] = useState(null);

  const [autoSkip, setAutoSkip] = useState(true);
  const [playChime, setPlayChime] = useState(true);
  const [adsSkippedCount, setAdsSkippedCount] = useState(() => Number(localStorage.getItem('skipcast_skipped_count')) || 0);
  const [timeSavedSec, setTimeSavedSec] = useState(() => Number(localStorage.getItem('skipcast_saved_sec')) || 0);
  const [skipBanner, setSkipBanner] = useState(null);

  const [isScanning, setIsScanning] = useState(false);
  const [scanStage, setScanStage] = useState('');
  const [activeTab, setActiveTab] = useState('player');

  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [isSearching, setIsSearching] = useState(false);

  const [isUpdatingFeeds, setIsUpdatingFeeds] = useState(false);
  const [feedUpdateProgress, setFeedUpdateProgress] = useState('');
  const [lastFeedCheck, setLastFeedCheck] = useState(() => localStorage.getItem('skipcast_last_check') || 'Never');

  const [offlineIds, setOfflineIds] = useState([]);
  const [downloadingId, setDownloadingId] = useState(null);
  const [playingOfflineBlob, setPlayingOfflineBlob] = useState(false);

  const [apiKey, setApiKey] = useState(() => localStorage.getItem('skipcast_gemini_key') || '');
  const [customAudioUrl, setCustomAudioUrl] = useState('');
  const [customTitle, setCustomTitle] = useState('');
  const [isImportingRss, setIsImportingRss] = useState(false);
  const [importStatus, setImportStatus] = useState('');

  const [manualStart, setManualStart] = useState('');
  const [manualEnd, setManualEnd] = useState('');

  const audioRef = useRef(null);
  const audioCtxRef = useRef(null);
  const lastSkippedAdRef = useRef(null);
  const activeBlobUrlRef = useRef(null);
  const opmlInputRef = useRef(null);
  const shouldAutoPlayNextRef = useRef(false);

  const currentEp = episodes.find(e => e.id === currentEpId) || episodes[0];

  const showToast = (msg) => {
    setStatusToast(msg);
    setTimeout(() => setStatusToast(null), 3800);
  };

  useEffect(() => {
    try {
      localStorage.setItem('skipcast_episodes_v6', JSON.stringify(episodes));
    } catch (_) {}
  }, [episodes]);

  useEffect(() => {
    try {
      localStorage.setItem('skipcast_subscriptions_v5', JSON.stringify(subscriptions));
    } catch (_) {}
  }, [subscriptions]);

  useEffect(() => {
    localStorage.setItem('skipcast_active_ep', currentEpId);
  }, [currentEpId]);

  useEffect(() => {
    localStorage.setItem('skipcast_skipped_count', String(adsSkippedCount));
    localStorage.setItem('skipcast_saved_sec', String(timeSavedSec));
  }, [adsSkippedCount, timeSavedSec]);

  useEffect(() => {
    localStorage.setItem('skipcast_gemini_key', apiKey);
  }, [apiKey]);

  useEffect(() => {
    getAllOfflineKeys().then(keys => setOfflineIds(keys));
  }, []);

  useEffect(() => {
    let isCancelled = false;
    const loadAudioSource = async () => {
      if (!audioRef.current || !currentEp) return;
      setAudioError(null);
      audioRef.current.pause();
      setIsPlaying(false);
      setCurrentTime(0);
      setDuration(currentEp.duration || 1800);
      lastSkippedAdRef.current = null;

      if (activeBlobUrlRef.current) {
        URL.revokeObjectURL(activeBlobUrlRef.current);
        activeBlobUrlRef.current = null;
      }

      try {
        const offlineBlob = await getEpisodeBlob(currentEp.id);
        if (!isCancelled && offlineBlob) {
          const blobUrl = URL.createObjectURL(offlineBlob);
          activeBlobUrlRef.current = blobUrl;
          audioRef.current.src = blobUrl;
          setPlayingOfflineBlob(true);
        } else if (!isCancelled) {
          audioRef.current.src = currentEp.audioUrl || '';
          setPlayingOfflineBlob(false);
        }
        if (!isCancelled) {
          audioRef.current.load();
          if (shouldAutoPlayNextRef.current) {
            shouldAutoPlayNextRef.current = false;
            try {
              await audioRef.current.play();
              setIsPlaying(true);
            } catch (_) {}
          }
        }
      } catch (_) {
        if (!isCancelled) {
          audioRef.current.src = currentEp.audioUrl || '';
          setPlayingOfflineBlob(false);
          audioRef.current.load();
        }
      }
    };
    loadAudioSource();
    return () => { isCancelled = true; };
  }, [currentEpId]);

  // NATIVE ANDROID + WEB MEDIASESSION BRIDGE
  useEffect(() => {
    if (!currentEp) return;
    const artUrl = currentEp.artwork || DEFAULT_ARTWORK;
    const metaPayload = {
      title: currentEp.title || 'SkipCast Episode',
      artist: currentEp.podcast || 'SkipCast AI Player',
      album: autoSkip ? 'SkipCast • Auto-Skip ON' : 'SkipCast • Auto-Skip OFF',
      artwork: [{ src: artUrl, sizes: '512x512', type: 'image/jpeg' }]
    };

    const syncNativeMediaSession = async () => {
      const NativeMedia = getNativeMediaSession();
      if (NativeMedia) {
        try {
          await NativeMedia.setMetadata(metaPayload);
          await NativeMedia.setActionHandler({ action: 'play' }, async () => {
            if (audioRef.current) {
              await audioRef.current.play();
              setIsPlaying(true);
            }
          });
          await NativeMedia.setActionHandler({ action: 'pause' }, () => {
            if (audioRef.current) {
              audioRef.current.pause();
              setIsPlaying(false);
            }
          });
          await NativeMedia.setActionHandler({ action: 'seekbackward' }, (details) => {
            const offset = details?.seekOffset || 15;
            if (audioRef.current) {
              const next = Math.max(0, audioRef.current.currentTime - offset);
              audioRef.current.currentTime = next;
              setCurrentTime(next);
            }
          });
          await NativeMedia.setActionHandler({ action: 'seekforward' }, (details) => {
            const offset = details?.seekOffset || 30;
            if (audioRef.current) {
              const next = Math.min(duration || 3600, audioRef.current.currentTime + offset);
              audioRef.current.currentTime = next;
              setCurrentTime(next);
            }
          });
          await NativeMedia.setActionHandler({ action: 'seekto' }, (details) => {
            if (audioRef.current && details?.seekTime != null) {
              lastSkippedAdRef.current = null;
              audioRef.current.currentTime = details.seekTime;
              setCurrentTime(details.seekTime);
            }
          });
          await NativeMedia.setActionHandler({ action: 'nexttrack' }, () => {
            if (audioRef.current) {
              const now = audioRef.current.currentTime;
              const activeAd = currentEp.ads?.find(a => now >= a.startTime && now < a.endTime);
              const target = activeAd ? activeAd.endTime : Math.min(duration || 3600, now + 30);
              audioRef.current.currentTime = target;
              setCurrentTime(target);
            }
          });
          await NativeMedia.setActionHandler({ action: 'previoustrack' }, () => {
            if (audioRef.current) {
              const next = Math.max(0, audioRef.current.currentTime - 15);
              audioRef.current.currentTime = next;
              setCurrentTime(next);
            }
          });
        } catch (_) {}
      }
    };
    syncNativeMediaSession();

    if ('mediaSession' in navigator) {
      try {
        navigator.mediaSession.metadata = new window.MediaMetadata(metaPayload);
      } catch (_) {}
    }
  }, [currentEp, autoSkip, duration]);

  useEffect(() => {
    const stateStr = isPlaying ? 'playing' : 'paused';
    const NativeMedia = getNativeMediaSession();
    if (NativeMedia) {
      try {
        NativeMedia.setPlaybackState({ playbackState: stateStr });
      } catch (_) {}
    }
    if ('mediaSession' in navigator) {
      navigator.mediaSession.playbackState = stateStr;
    }
  }, [isPlaying]);

  const handleEpisodeEnded = () => {
    setIsPlaying(false);
    const currentIndex = episodes.findIndex(e => e.id === currentEp?.id);
    if (currentIndex !== -1 && currentIndex + 1 < episodes.length) {
      const nextEp = episodes[currentIndex + 1];
      shouldAutoPlayNextRef.current = true;
      setCurrentEpId(nextEp.id);
      showToast(`Playing next in queue: ${nextEp.title}`);
    }
  };

  const triggerSkipChime = () => {
    if (!playChime) return;
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!audioCtxRef.current) audioCtxRef.current = new Ctx();
      const ctx = audioCtxRef.current;
      if (ctx.state === 'suspended') ctx.resume();
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
    } catch (_) {}
  };

  const handleTimeUpdate = () => {
    const audio = audioRef.current;
    if (!audio) return;
    const now = audio.currentTime;
    setCurrentTime(now);

    const validDur = audio.duration && isFinite(audio.duration) ? audio.duration : duration;
    if (validDur > 0 && now <= validDur) {
      if (Math.floor(now) !== Math.floor(now - 0.25)) {
        const NativeMedia = getNativeMediaSession();
        if (NativeMedia) {
          try {
            NativeMedia.setPositionState({
              duration: validDur,
              playbackRate: audio.playbackRate || 1.0,
              position: now
            });
          } catch (_) {}
        }
      }
    }

    if (autoSkip && currentEp?.scanned && currentEp.ads?.length > 0) {
      const hitAd = currentEp.ads.find(
        ad => !ad.whitelisted && now >= ad.startTime && now < ad.endTime - 0.5
      );
      if (hitAd && lastSkippedAdRef.current !== hitAd.id) {
        lastSkippedAdRef.current = hitAd.id;
        const saved = Math.max(1, Math.round(hitAd.endTime - now));
        audio.currentTime = hitAd.endTime;
        setCurrentTime(hitAd.endTime);
        setAdsSkippedCount(c => c + 1);
        setTimeSavedSec(s => s + saved);
        setSkipBanner(`Skipped ${hitAd.sponsor} (${saved}s saved)`);
        triggerSkipChime();
        setTimeout(() => setSkipBanner(null), 3500);
      }
    }
  };

  const handleLoadedMetadata = () => {
    const audio = audioRef.current;
    if (!audio) return;
    const realDur = audio.duration;
    if (realDur && isFinite(realDur) && realDur > 0) {
      setDuration(realDur);
      setEpisodes(prev => prev.map(ep => ep.id === currentEp.id ? { ...ep, duration: Math.round(realDur) } : ep));
    }
  };

  const togglePlay = async () => {
    const audio = audioRef.current;
    if (!audio) return;
    setAudioError(null);
    if (isPlaying) {
      audio.pause();
      setIsPlaying(false);
    } else {
      try {
        await audio.play();
        setIsPlaying(true);
      } catch (err) {
        setAudioError('Playback failed: Verify stream URL or download episode for offline playback.');
        setIsPlaying(false);
      }
    }
  };

  const seekTo = (newTime) => {
    const audio = audioRef.current;
    const clamped = Math.max(0, Math.min(duration || 3600, newTime));
    lastSkippedAdRef.current = null;
    if (audio) audio.currentTime = clamped;
    setCurrentTime(clamped);
  };

  const formatTime = (sec) => {
    if (!sec || !isFinite(sec)) return '0:00';
    const hrs = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = Math.floor(sec % 60);
    if (hrs > 0) return `${hrs}:${m < 10 ? '0' : ''}${m}:${s < 10 ? '0' : ''}${s}`;
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  const formatShortDate = (dateStr) => {
    if (!dateStr) return '';
    try {
      const d = new Date(dateStr);
      if (isNaN(d.getTime())) return '';
      return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
    } catch (_) {
      return '';
    }
  };

  const handleTestSkip = async (ad) => {
    const target = Math.max(0, ad.startTime - 2);
    seekTo(target);
    if (!isPlaying && audioRef.current) {
      try {
        await audioRef.current.play();
        setIsPlaying(true);
      } catch (_) {}
    }
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

  const deleteAdMarker = (adId) => {
    setEpisodes(prev => prev.map(ep => {
      if (ep.id !== currentEp.id) return ep;
      return {
        ...ep,
        ads: (ep.ads || []).filter(a => a.id !== adId)
      };
    }));
  };

  const moveQueueItem = (index, direction, e) => {
    if (e) e.stopPropagation();
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= episodes.length) return;
    setEpisodes(prev => {
      const copy = [...prev];
      const [moved] = copy.splice(index, 1);
      copy.splice(targetIndex, 0, moved);
      return copy;
    });
  };

  const deleteEpisodeFromQueue = (epId, e) => {
    if (e) e.stopPropagation();
    if (episodes.length <= 1) {
      showToast('Keep at least one episode in the queue');
      return;
    }
    deleteEpisodeBlob(epId).catch(() => {});
    const remaining = episodes.filter(ep => ep.id !== epId);
    setEpisodes(remaining);
    if (currentEpId === epId) {
      setCurrentEpId(remaining[0].id);
    }
    showToast('Removed track from queue');
  };

  const clearOtherQueueTracks = () => {
    if (!currentEp || episodes.length <= 1) return;
    episodes.forEach(ep => {
      if (ep.id !== currentEp.id) {
        deleteEpisodeBlob(ep.id).catch(() => {});
      }
    });
    setEpisodes([currentEp]);
    showToast('Cleared other tracks from queue');
  };

  const handleToggleOfflineDownload = async (ep, e) => {
    if (e) e.stopPropagation();
    if (offlineIds.includes(ep.id)) {
      await deleteEpisodeBlob(ep.id);
      setOfflineIds(prev => prev.filter(id => id !== ep.id));
      if (ep.id === currentEp.id) setPlayingOfflineBlob(false);
      return;
    }

    setEpisodes(prev => {
      if (prev.some(item => item.id === ep.id || item.audioUrl === ep.audioUrl)) return prev;
      return [...prev, ep];
    });

    setDownloadingId(ep.id);
    setAudioError(null);
    try {
      let resp;
      try {
        resp = await fetch(ep.audioUrl);
      } catch (_) {
        resp = await fetch(`https://corsproxy.io/?${encodeURIComponent(ep.audioUrl)}`);
      }
      if (!resp || !resp.ok) throw new Error('Download failed');
      const blob = await resp.blob();
      await saveEpisodeBlob(ep.id, blob);
      const updatedKeys = await getAllOfflineKeys();
      setOfflineIds(updatedKeys);

      if (ep.id === currentEp.id && audioRef.current) {
        const blobUrl = URL.createObjectURL(blob);
        activeBlobUrlRef.current = blobUrl;
        const wasTime = audioRef.current.currentTime;
        audioRef.current.src = blobUrl;
        audioRef.current.currentTime = wasTime;
        setPlayingOfflineBlob(true);
      }
      showToast('Episode saved for offline playback');
    } catch (err) {
      setAudioError('Offline download blocked by host CORS policy. Streaming playback still works.');
    } finally {
      setDownloadingId(null);
    }
  };

  const parseFeedXml = (xmlText, feedUrl, fallbackArt, maxItems = 60) => {
    const parser = new DOMParser();
    const xml = parser.parseFromString(xmlText, 'text/xml');
    const channelTitle = xml.querySelector('channel > title')?.textContent?.trim() || 'Subscribed Podcast';
    const channelDesc = xml.querySelector('channel > description')?.textContent?.replace(/<[^>]+>/g, '')?.trim() || '';
    const channelArt =
      fallbackArt ||
      xml.querySelector('channel > image > url')?.textContent?.trim() ||
      xml.getElementsByTagName('itunes:image')?.[0]?.getAttribute('href') ||
      DEFAULT_ARTWORK;

    const items = Array.from(xml.querySelectorAll('item')).slice(0, maxItems);
    const parsedEps = items.map((item, idx) => {
      const epTitle = item.querySelector('title')?.textContent?.trim() || `Episode ${idx + 1}`;
      const enclosure = item.querySelector('enclosure')?.getAttribute('url') || '';
      const rawGuid = item.querySelector('guid')?.textContent?.trim() || enclosure || `${feedUrl}-${epTitle}`;
      const pubDate = item.querySelector('pubDate')?.textContent || '';
      const desc = item.querySelector('description')?.textContent?.replace(/<[^>]+>/g, '') || '';
      const epArt = item.getElementsByTagName('itunes:image')?.[0]?.getAttribute('href') || channelArt;

      let parsedDur = 1800;
      const durStr = item.getElementsByTagName('itunes:duration')?.[0]?.textContent?.trim();
      if (durStr) {
        if (durStr.includes(':')) {
          const parts = durStr.split(':').map(Number);
          if (parts.length === 3) parsedDur = parts[0] * 3600 + parts[1] * 60 + parts[2];
          else if (parts.length === 2) parsedDur = parts[0] * 60 + parts[1];
        } else if (!isNaN(Number(durStr))) {
          parsedDur = Number(durStr);
        }
      }

      const safeHash = btoa(unescape(encodeURIComponent(rawGuid))).replace(/[^a-zA-Z0-9]/g, '').slice(0, 22);

      return {
        id: `ep-${safeHash}-${idx}`,
        guid: rawGuid,
        feedUrl,
        title: epTitle,
        podcast: channelTitle,
        audioUrl: enclosure,
        artwork: epArt,
        pubDate,
        duration: parsedDur || 1800,
        scanned: false,
        ads: [],
        rawNotes: desc.slice(0, 1500),
        transcript: [
          { start: 0, end: 60, text: desc ? desc.slice(0, 450) + '...' : 'Episode loaded from RSS feed. Press Play to stream or tap Download Offline.', isAd: false }
        ]
      };
    }).filter(ep => ep.audioUrl);

    return { channelTitle, channelDesc, channelArt, parsedEps };
  };

  const openPodcastShowView = async (sub, forceRefresh = false) => {
    setSelectedPodcast(sub);
    setEpisodeFilterQuery('');
    setIsLoadingShowEps(true);

    if (!forceRefresh) {
      const cached = await getShowArchiveCache(sub.feedUrl);
      if (cached && cached.length > 0) {
        setSelectedPodcastEpisodes(cached);
        setIsLoadingShowEps(false);
        return;
      }
    }

    try {
      const xmlText = await fetchFeedXmlText(sub.feedUrl);
      if (xmlText && xmlText.includes('<item')) {
        const { channelTitle, channelArt, parsedEps } = parseFeedXml(xmlText, sub.feedUrl, sub.artwork, 60);
        setSelectedPodcastEpisodes(parsedEps);
        await saveShowArchiveCache(sub.feedUrl, parsedEps);

        setSubscriptions(prev => prev.map(s => s.id === sub.id ? {
          ...s,
          title: s.title === 'Subscribed Podcast' ? channelTitle : s.title,
          artwork: s.artwork === DEFAULT_ARTWORK ? channelArt : s.artwork,
          episodeCount: parsedEps.length
        } : s));
      } else {
        setAudioError('Could not load episode list from this RSS feed.');
      }
    } catch (_) {
      setAudioError('Error fetching podcast episodes.');
    } finally {
      setIsLoadingShowEps(false);
    }
  };

  const playEpisodeFromShow = (ep) => {
    setEpisodes(prev => {
      const exists = prev.find(item => item.audioUrl === ep.audioUrl || item.id === ep.id);
      if (exists) {
        setCurrentEpId(exists.id);
        return prev;
      }
      setCurrentEpId(ep.id);
      return [ep, ...prev];
    });
    setActiveTab('player');
  };

  const addEpisodeToQueue = (ep, e) => {
    if (e) e.stopPropagation();
    const alreadyInQueue = episodes.some(item => item.audioUrl === ep.audioUrl || item.id === ep.id);
    if (alreadyInQueue) {
      showToast('Episode is already in your Queue');
      return;
    }
    setEpisodes(prev => [...prev, ep]);
    showToast('Added to end of Queue');
  };

  const isSubscribed = (feedUrl) => {
    if (!feedUrl) return false;
    return subscriptions.some(s => s.feedUrl.toLowerCase() === feedUrl.toLowerCase());
  };

  const toggleSubscription = async (showObj, e) => {
    if (e) e.stopPropagation();
    const { feedUrl, title, author, artwork } = showObj;
    if (!feedUrl) return;

    if (isSubscribed(feedUrl)) {
      setSubscriptions(prev => prev.filter(s => s.feedUrl.toLowerCase() !== feedUrl.toLowerCase()));
      if (selectedPodcast?.feedUrl?.toLowerCase() === feedUrl.toLowerCase()) {
        setSelectedPodcast(null);
      }
      showToast(`Unsubscribed from ${title}`);
      return;
    }

    const newSub = {
      id: `sub-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      title: title || 'Subscribed Podcast',
      author: author || '',
      feedUrl,
      artwork: artwork || DEFAULT_ARTWORK,
      episodeCount: 0,
      addedAt: new Date().toISOString()
    };

    setSubscriptions(prev => [newSub, ...prev]);
    showToast(`Subscribed to ${newSub.title}! Caching last 60 episodes...`);

    try {
      const xmlText = await fetchFeedXmlText(feedUrl);
      if (xmlText && xmlText.includes('<item')) {
        const { channelTitle, channelArt, parsedEps } = parseFeedXml(xmlText, feedUrl, artwork, 60);
        await saveShowArchiveCache(feedUrl, parsedEps);

        setSubscriptions(prev => prev.map(s => s.id === newSub.id ? {
          ...s,
          title: s.title === 'Subscribed Podcast' ? channelTitle : s.title,
          artwork: s.artwork === DEFAULT_ARTWORK ? channelArt : s.artwork,
          episodeCount: parsedEps.length
        } : s));
      }
    } catch (_) {}
  };

  const checkNewEpisodesForSubscriptions = async () => {
    if (subscriptions.length === 0) {
      showToast('No subscribed podcasts yet. Add shows via Search or OPML!');
      return;
    }

    setIsUpdatingFeeds(true);
    let newAddedTotal = 0;
    const existingKeys = new Set(episodes.flatMap(e => [e.audioUrl, e.guid].filter(Boolean)));
    const allNewEpisodes = [];

    for (let i = 0; i < subscriptions.length; i++) {
      const sub = subscriptions[i];
      setFeedUpdateProgress(`Refreshing (${i + 1}/${subscriptions.length}): ${sub.title}...`);
      try {
        const xmlText = await fetchFeedXmlText(sub.feedUrl);
        if (xmlText && xmlText.includes('<item')) {
          const { channelTitle, channelArt, parsedEps } = parseFeedXml(xmlText, sub.feedUrl, sub.artwork, 60);
          await saveShowArchiveCache(sub.feedUrl, parsedEps);

          setSubscriptions(prev => prev.map(s => s.feedUrl === sub.feedUrl ? {
            ...s,
            artwork: s.artwork === DEFAULT_ARTWORK ? channelArt : s.artwork,
            title: s.title || channelTitle,
            episodeCount: parsedEps.length
          } : s));

          for (const ep of parsedEps.slice(0, 2)) {
            if (!existingKeys.has(ep.audioUrl) && !existingKeys.has(ep.guid)) {
              existingKeys.add(ep.audioUrl);
              existingKeys.add(ep.guid);
              allNewEpisodes.push(ep);
              newAddedTotal++;
            }
          }
        }
      } catch (_) {}
    }

    if (allNewEpisodes.length > 0) {
      setEpisodes(prev => [...allNewEpisodes, ...prev]);
    }

    const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    setLastFeedCheck(`Today at ${timestamp}`);
    localStorage.setItem('skipcast_last_check', `Today at ${timestamp}`);
    setIsUpdatingFeeds(false);
    setFeedUpdateProgress('');

    if (newAddedTotal > 0) {
      showToast(`Refreshed 60-ep archives & added ${newAddedTotal} new episode${newAddedTotal > 1 ? 's' : ''} to Queue!`);
    } else {
      showToast('All podcast archives updated! No brand-new episodes since last check.');
    }
  };

  const handleOpmlFileSelect = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const parser = new DOMParser();
      const doc = parser.parseFromString(text, 'text/xml');
      const outlines = Array.from(doc.querySelectorAll('outline[xmlUrl], outline[xmlurl]'));

      if (outlines.length === 0) {
        setAudioError('No valid RSS feeds (<outline xmlUrl="...">) found in that OPML file.');
        return;
      }

      const existingFeeds = new Set(subscriptions.map(s => s.feedUrl.toLowerCase()));
      const importedSubs = [];

      outlines.forEach((node, idx) => {
        const feedUrl = (node.getAttribute('xmlUrl') || node.getAttribute('xmlurl') || '').trim();
        if (!feedUrl || existingFeeds.has(feedUrl.toLowerCase())) return;
        existingFeeds.add(feedUrl.toLowerCase());

        const title =
          node.getAttribute('title') ||
          node.getAttribute('text') ||
          `Imported Podcast ${idx + 1}`;

        importedSubs.push({
          id: `opml-${Date.now()}-${idx}`,
          title: title.trim(),
          author: 'Tap to browse last 60 episodes',
          feedUrl,
          artwork: DEFAULT_ARTWORK,
          episodeCount: 0,
          addedAt: new Date().toISOString()
        });
      });

      if (importedSubs.length > 0) {
        setSubscriptions(prev => [...importedSubs, ...prev]);
        showToast(`Imported ${importedSubs.length} podcasts! Tap any show to browse its last 60 episodes.`);
        setSelectedPodcast(null);
        setActiveTab('subscribed');
      } else {
        showToast(`All ${outlines.length} podcasts in that OPML file are already in your Subscribed list.`);
        setActiveTab('subscribed');
      }
    } catch (err) {
      setAudioError('Failed to parse OPML file. Ensure it is a valid XML/OPML export.');
    } finally {
      if (opmlInputRef.current) opmlInputRef.current.value = '';
    }
  };

  const handleExportOpml = () => {
    if (subscriptions.length === 0) {
      showToast('No subscriptions to export yet.');
      return;
    }
    const outlinesXml = subscriptions
      .map(s => {
        const safeTitle = (s.title || 'Podcast').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
        const safeUrl = s.feedUrl.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
        return `      <outline type="rss" text="${safeTitle}" title="${safeTitle}" xmlUrl="${safeUrl}" />`;
      })
      .join('\n');

    const opmlContent = `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
  <head>
    <title>SkipCast Podcast Subscriptions</title>
  </head>
  <body>
    <outline text="feeds">
${outlinesXml}
    </outline>
  </body>
</opml>`;

    const blob = new Blob([opmlContent], { type: 'text/x-opml+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'skipcast-subscriptions.opml';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast('Exported skipcast-subscriptions.opml');
  };

  const handlePodcastSearch = async (e) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;
    setIsSearching(true);
    setSearchResults([]);
    try {
      const res = await fetch(`https://itunes.apple.com/search?media=podcast&entity=podcast&limit=15&term=${encodeURIComponent(searchQuery.trim())}`);
      const data = await res.json();
      setSearchResults(data.results || []);
    } catch (_) {
      setAudioError('Directory search failed. Check your internet connection.');
    } finally {
      setIsSearching(false);
    }
  };

  const handleManualImport = async (e) => {
    e.preventDefault();
    const url = customAudioUrl.trim();
    if (!url) return;

    const isDirectAudio = /\.(mp3|m4a|aac|ogg|wav)(\?.*)?$/i.test(url);
    if (!isDirectAudio) {
      setIsImportingRss(true);
      setImportStatus('Subscribing & fetching 60-episode archive...');
      await toggleSubscription({
        title: customTitle.trim() || 'Subscribed Podcast',
        author: 'Custom RSS Feed',
        feedUrl: url,
        artwork: DEFAULT_ARTWORK
      });
      setIsImportingRss(false);
      setImportStatus('');
      setCustomAudioUrl('');
      setCustomTitle('');
      setActiveTab('subscribed');
      return;
    }

    const newId = `ep-${Date.now()}`;
    const newEp = {
      id: newId,
      guid: url,
      title: customTitle.trim() || 'Direct Audio Stream',
      podcast: 'Custom Stream Import',
      audioUrl: url,
      artwork: DEFAULT_ARTWORK,
      duration: 1800,
      scanned: false,
      ads: [],
      rawNotes: '',
      transcript: [
        { start: 0, end: 30, text: 'Direct audio stream initialized. Press Play below to load full duration.', isAd: false }
      ]
    };
    setEpisodes(prev => [...prev, newEp]);
    setCurrentEpId(newId);
    setCustomTitle('');
    setCustomAudioUrl('');
    setActiveTab('player');
  };

  // TRI-WINDOW GEMINI 2.5 FLASH AUDIO SCANNER WITH ACOUSTIC SILENCE DIPS
  const runAiAdScan = async () => {
    setIsScanning(true);
    setAudioError(null);
    const epDur = duration > 60 ? duration : (currentEp.duration || 1800);

    try {
      let detectedAds = [];

      if (!apiKey.trim()) {
        setAudioError('Add a Gemini API key in Settings to run real audio/transcript ad detection. You can also add exact ad start/end seconds manually below.');
        setEpisodes(prev => prev.map(ep => ep.id === currentEp.id ? { ...ep, scanned: true, ads: ep.ads || [] } : ep));
        return;
      }

      if (currentEp.audioUrl) {
        const chunkBytes = 2200000; // ~2.2 MB per window (~2.5-3 mins at 128kbps)
        let startBuffer = null;
        let midBuffer = null;
        let lateBuffer = null;
        let startChunkBase64 = null;
        let midChunkBase64 = null;
        let lateChunkBase64 = null;
        let midStartSec = Math.round(epDur * 0.45);
        let lateStartSec = Math.round(epDur * 0.75);

        // 1. Fetch opening audio window (~0:00 onward)
        setScanStage('1/5 Sampling opening audio chunk...');
        const startRange = await fetchAudioRange(currentEp.audioUrl, 0, chunkBytes - 1);
        if (startRange?.buffer) {
          startBuffer = startRange.buffer;
          startChunkBase64 = arrayBufferToBase64(startRange.buffer);
        }

        const estimatedBytesPerSec = startRange?.totalBytes
          ? startRange.totalBytes / epDur
          : 16000; // ~128kbps fallback

        // 2. Fetch mid-episode audio window (~45% into the episode)
        if (epDur > 180) {
          setScanStage('2/5 Fetching mid-episode audio chunk (~45%)...');
          const midStartByte = Math.max(
            chunkBytes + 65536,
            Math.round(epDur * 0.45 * estimatedBytesPerSec)
          );
          midStartSec = Math.max(30, Math.round(midStartByte / estimatedBytesPerSec));
          const midEndByte = midStartByte + chunkBytes - 1;

          const midRange = await fetchAudioRange(currentEp.audioUrl, midStartByte, midEndByte);
          if (midRange?.buffer) {
            midBuffer = midRange.buffer;
            midChunkBase64 = arrayBufferToBase64(midRange.buffer);
          }
        }

        // 3. Fetch late-roll audio window (~75% into the episode)
        if (epDur > 300) {
          setScanStage('3/5 Fetching late-roll audio chunk (~75%)...');
          const lateStartByte = Math.max(
            chunkBytes * 2 + 131072,
            Math.round(epDur * 0.75 * estimatedBytesPerSec)
          );
          lateStartSec = Math.max(midStartSec + 60, Math.round(lateStartByte / estimatedBytesPerSec));
          const lateEndByte = lateStartByte + chunkBytes - 1;

          const lateRange = await fetchAudioRange(currentEp.audioUrl, lateStartByte, lateEndByte);
          if (lateRange?.buffer) {
            lateBuffer = lateRange.buffer;
            lateChunkBase64 = arrayBufferToBase64(lateRange.buffer);
          }
        }

        setScanStage('4/5 Analyzing opening, mid & late audio with Gemini 2.5 Flash...');

        const promptText = `You are a precision podcast ad-boundary detector analyzing real audio clips from a podcast episode.
Episode Metadata:
- Title: "${currentEp.title}"
- Total Duration: ${Math.round(epDur)} seconds
- Show Notes: "${(currentEp.rawNotes || '').slice(0, 1500)}"

Attached Audio Chunks:
1. Clip 1 (Opening sample): starts at 0 seconds in the episode.
${midChunkBase64 ? `2. Clip 2 (Mid-episode sample): starts at approximately ${midStartSec} seconds into the episode.` : ''}
${lateChunkBase64 ? `3. Clip 3 (Late-roll sample): starts at approximately ${lateStartSec} seconds into the episode.` : ''}

Instructions:
- Listen carefully to ALL attached audio clips for host-read sponsorships, promo codes, sponsor URLs, transition jingles/stingers, or dynamically inserted ads.
- Convert timestamps relative to Clip 2 into full-episode seconds by adding ~${midStartSec}s when an ad is heard in Clip 2.
- Convert timestamps relative to Clip 3 into full-episode seconds by adding ~${lateStartSec}s when an ad is heard in Clip 3.
- Do NOT assume a fixed number of ads or force an ad at 0:00 if none is present.
- Return only intervals where 0 <= startTime < endTime <= ${Math.round(epDur)}.
- If no ads are detected in any audio clip or show notes, return [].

Return a valid JSON array with this structure:
[
  {
    "startTime": <number in seconds>,
    "endTime": <number in seconds>,
    "sponsor": "<string: sponsor name or ad type>",
    "category": "<Host-Read Sponsor | Mid-Roll Ad | Late-Roll Ad | Dynamic Ad | Promo Read>",
    "confidence": <number between 0.5 and 0.99>,
    "reason": "<specific vocal/acoustic cue in opening, mid-roll, or late-roll clip>"
  }
]
Output ONLY valid JSON.`;

        const requestParts = [{ text: promptText }];
        if (startChunkBase64) requestParts.push({ inlineData: { mimeType: 'audio/mp3', data: startChunkBase64 } });
        if (midChunkBase64) requestParts.push({ inlineData: { mimeType: 'audio/mp3', data: midChunkBase64 } });
        if (lateChunkBase64) requestParts.push({ inlineData: { mimeType: 'audio/mp3', data: lateChunkBase64 } });

        const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key=${apiKey.trim()}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: requestParts }],
            generationConfig: { responseMimeType: 'application/json' }
          })
        });

        if (resp.ok) {
          const data = await resp.json();
          const rawJson = data?.candidates?.[0]?.content?.parts?.[0]?.text;
          if (rawJson) {
            const parsed = JSON.parse(rawJson);
            if (Array.isArray(parsed) && parsed.length > 0) {
              setScanStage('5/5 Snapping ad boundaries to acoustic silence dips...');

              const rawAds = parsed
                .map((item, i) => ({
                  id: `gemini-audio-${Date.now()}-${i}`,
                  startTime: Math.max(0, Math.round(Number(item.startTime) || 0)),
                  endTime: Math.min(Math.round(epDur), Math.round(Number(item.endTime) || 0)),
                  sponsor: item.sponsor || 'Sponsor Read',
                  category: item.category || 'Gemini Tri-Window AI',
                  confidence: Number(item.confidence) || 0.9,
                  reason: item.reason || 'Detected by Gemini 2.5 Flash',
                  whitelisted: false
                }))
                .filter(ad => ad.endTime > ad.startTime);

              // Snapping each ad boundary to the nearest silence dip in the corresponding audio buffer
              for (const ad of rawAds) {
                // Determine which clip contains startTime and endTime
                let startBufferToUse = null;
                let startChunkOffset = 0;
                if (ad.startTime < midStartSec) {
                  startBufferToUse = startBuffer;
                  startChunkOffset = 0;
                } else if (ad.startTime < lateStartSec) {
                  startBufferToUse = midBuffer;
                  startChunkOffset = midStartSec;
                } else {
                  startBufferToUse = lateBuffer;
                  startChunkOffset = lateStartSec;
                }

                let endBufferToUse = null;
                let endChunkOffset = 0;
                if (ad.endTime < midStartSec) {
                  endBufferToUse = startBuffer;
                  endChunkOffset = 0;
                } else if (ad.endTime < lateStartSec) {
                  endBufferToUse = midBuffer;
                  endChunkOffset = midStartSec;
                } else {
                  endBufferToUse = lateBuffer;
                  endChunkOffset = lateStartSec;
                }

                const snappedStart = await snapToNearestSilence(startBufferToUse, ad.startTime, startChunkOffset);
                const snappedEnd = await snapToNearestSilence(endBufferToUse, ad.endTime, endChunkOffset);

                ad.startTime = Math.min(snappedStart, ad.endTime - 1);
                ad.endTime = Math.max(snappedEnd, ad.startTime + 1);
              }

              detectedAds = rawAds.sort((a, b) => a.startTime - b.startTime);
            }
          }
        } else {
          const errJson = await resp.json().catch(() => null);
          const errMsg = errJson?.error?.message || `HTTP ${resp.status} ${resp.statusText}`;
          setAudioError(`Gemini Error: ${errMsg}`);
        }
      }

      setEpisodes(prev => prev.map(ep => {
        if (ep.id !== currentEp.id) return ep;
        return { ...ep, scanned: true, ads: detectedAds };
      }));

      showToast(
        detectedAds.length > 0
          ? `Snapped ${detectedAds.length} ad segment${detectedAds.length > 1 ? 's' : ''} to audio silence pauses`
          : 'Scan complete: no ads detected in sampled audio'
      );
    } catch (_) {
      setAudioError('Could not complete tri-window scan. You can still add custom start/end times manually.');
    } finally {
      setIsScanning(false);
      setScanStage('');
    }
  };

  const handleAddManualAd = (e) => {
    e.preventDefault();
    const s = Number(manualStart);
    const end = Number(manualEnd);
    if (isNaN(s) || isNaN(end) || end <= s) return;
    const newAd = {
      id: `manual-${Date.now()}`,
      startTime: s,
      endTime: end,
      sponsor: 'Custom Skip Range',
      category: 'User Flagged',
      confidence: 1.0,
      reason: 'Manually added skip marker',
      whitelisted: false
    };
    setEpisodes(prev => prev.map(ep => {
      if (ep.id !== currentEp.id) return ep;
      return {
        ...ep,
        scanned: true,
        ads: [...(ep.ads || []), newAd].sort((a, b) => a.startTime - b.startTime)
      };
    }));
    setManualStart('');
    setManualEnd('');
  };

  const isCurrentOffline = offlineIds.includes(currentEp?.id);

  const filteredShowEpisodes = selectedPodcastEpisodes.filter(ep =>
    !episodeFilterQuery.trim() ||
    ep.title.toLowerCase().includes(episodeFilterQuery.toLowerCase()) ||
    (ep.rawNotes && ep.rawNotes.toLowerCase().includes(episodeFilterQuery.toLowerCase()))
  );

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col pb-32">
      <audio
        ref={audioRef}
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={handleLoadedMetadata}
        onDurationChange={handleLoadedMetadata}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onEnded={handleEpisodeEnded}
        onError={() => setAudioError('Stream error: Check connection or use Download Offline.')}
        preload="metadata"
      />

      <header className="border-b border-slate-800 bg-slate-900/80 backdrop-blur sticky top-0 z-20 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400">
            <Scissors className="w-5 h-5" />
          </div>
          <div>
            <h1 className="font-bold text-base tracking-tight flex items-center gap-2">
              SkipCast
              <span className="text-[10px] font-semibold uppercase px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                v6.6 Silence Snapping
              </span>
            </h1>
            <p className="text-xs text-slate-400">Clean Sentence & Pause Ad Boundaries</p>
          </div>
        </div>

        <div className="bg-slate-800/90 border border-slate-700 rounded-lg px-2.5 py-1 text-right">
          <div className="text-[10px] text-slate-400 uppercase">Ads Skipped</div>
          <div className="text-xs font-bold text-emerald-400">{adsSkippedCount} ({timeSavedSec}s saved)</div>
        </div>
      </header>

      <div className="flex border-b border-slate-800 bg-slate-900/40 px-3 gap-1 pt-2 overflow-x-auto no-scrollbar">
        {[
          { id: 'player', label: 'Player' },
          { id: 'subscribed', label: `Subscribed (${subscriptions.length})` },
          { id: 'episodes', label: `Queue (${episodes.length})` },
          { id: 'discover', label: 'Search Shows' },
          { id: 'import', label: 'Import / OPML' },
          { id: 'settings', label: 'Settings' }
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-3 py-2 text-xs font-semibold border-b-2 whitespace-nowrap transition-colors ${
              activeTab === tab.id
                ? 'border-emerald-400 text-emerald-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {skipBanner && (
        <div className="mx-4 mt-3 bg-emerald-500/20 border border-emerald-500/40 text-emerald-200 px-3.5 py-2.5 rounded-xl flex items-center justify-between text-xs font-medium animate-pulse">
          <span className="flex items-center gap-2">
            <Zap className="w-4 h-4 text-emerald-400 shrink-0" />
            {skipBanner}
          </span>
          <span className="text-[10px] uppercase tracking-wider text-emerald-300">Auto-Jump</span>
        </div>
      )}

      {statusToast && (
        <div className="mx-4 mt-3 bg-emerald-500/15 border border-emerald-500/40 text-emerald-200 px-3.5 py-2 rounded-xl text-xs font-medium flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          {statusToast}
        </div>
      )}

      {audioError && (
        <div className="mx-4 mt-3 bg-rose-500/20 border border-rose-500/40 text-rose-200 px-3.5 py-2 rounded-xl text-xs flex items-center justify-between">
          <span>{audioError}</span>
          <button onClick={() => setAudioError(null)} className="text-[10px] underline ml-2">Dismiss</button>
        </div>
      )}

      <main className="flex-1 p-4 max-w-3xl w-full mx-auto space-y-4">
        {activeTab === 'player' && currentEp && (
          <>
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3">
              <div className="flex items-start gap-3">
                <img
                  src={currentEp.artwork || DEFAULT_ARTWORK}
                  alt=""
                  className="w-16 h-16 rounded-xl object-cover border border-slate-700 shrink-0"
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-emerald-400 truncate">{currentEp.podcast}</span>
                    {playingOfflineBlob && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 flex items-center gap-1 shrink-0">
                        <WifiOff className="w-3 h-3" /> Offline Ready
                      </span>
                    )}
                  </div>
                  <h2 className="text-sm font-bold text-white leading-snug mt-0.5">{currentEp.title}</h2>

                  <div className="flex flex-wrap items-center gap-2 mt-2">
                    <button
                      onClick={() => setAutoSkip(!autoSkip)}
                      className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold flex items-center gap-1 border ${
                        autoSkip
                          ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300'
                          : 'bg-slate-800 border-slate-700 text-slate-400'
                      }`}
                    >
                      <ShieldCheck className="w-3.5 h-3.5" />
                      {autoSkip ? 'Auto-Skip ON' : 'Auto-Skip OFF'}
                    </button>

                    <button
                      onClick={(e) => handleToggleOfflineDownload(currentEp, e)}
                      disabled={downloadingId === currentEp.id}
                      className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold flex items-center gap-1 border ${
                        isCurrentOffline
                          ? 'bg-slate-800 border-emerald-500/40 text-emerald-300'
                          : 'bg-slate-800 border-slate-700 text-slate-200 hover:bg-slate-700'
                      }`}
                    >
                      {downloadingId === currentEp.id ? (
                        <>
                          <RefreshCw className="w-3 h-3 animate-spin" /> Saving MP3...
                        </>
                      ) : isCurrentOffline ? (
                        <>
                          <CheckCircle2 className="w-3 h-3 text-emerald-400" /> Saved Offline
                        </>
                      ) : (
                        <>
                          <Download className="w-3 h-3" /> Download Offline
                        </>
                      )}
                    </button>
                  </div>
                </div>
              </div>

              {!currentEp.scanned ? (
                <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-3 space-y-2.5">
                  <span className="text-xs text-amber-200 font-medium flex items-center gap-1.5">
                    <AlertTriangle className="w-4 h-4 text-amber-400" />
                    Ready to scan & snap ad boundaries to silence dips ({formatTime(duration)})
                  </span>
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
                        Scan & Snap Boundaries with Gemini 2.5 Flash
                      </>
                    )}
                  </button>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="text-xs font-semibold text-slate-400 flex items-center justify-between">
                    <span>Detected Ad Segments ({currentEp.ads?.length || 0})</span>
                    <button onClick={runAiAdScan} className="text-[11px] text-emerald-400 underline">
                      Re-Scan Audio
                    </button>
                  </div>
                  {(currentEp.ads || []).length === 0 && (
                    <p className="text-xs text-slate-400 bg-slate-950/60 border border-slate-800 rounded-xl p-2.5">
                      No ad breaks flagged yet. Add a custom range below or re-scan with a Gemini API key.
                    </p>
                  )}
                  {currentEp.ads?.map(ad => (
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
                        <button
                          onClick={() => deleteAdMarker(ad.id)}
                          className="p-1.5 rounded-lg bg-slate-800 hover:bg-rose-500/20 text-slate-400 hover:text-rose-300"
                          title="Delete marker"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <form onSubmit={handleAddManualAd} className="pt-2 border-t border-slate-800/80 flex items-center gap-2">
                <input
                  type="number"
                  placeholder="Start (sec)"
                  value={manualStart}
                  onChange={e => setManualStart(e.target.value)}
                  className="w-24 bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-white"
                />
                <input
                  type="number"
                  placeholder="End (sec)"
                  value={manualEnd}
                  onChange={e => setManualEnd(e.target.value)}
                  className="w-24 bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-white"
                />
                <button
                  type="submit"
                  className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-emerald-400"
                >
                  + Add Ad Range
                </button>
              </form>
            </div>

            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-2">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">
                Episode Show Notes
              </h3>
              {currentEp.transcript?.map((seg, idx) => (
                <div
                  key={idx}
                  onClick={() => seekTo(seg.start)}
                  className="p-2.5 rounded-xl border bg-slate-950/60 border-slate-800/80 text-xs text-slate-300 cursor-pointer leading-relaxed"
                >
                  {seg.text}
                </div>
              ))}
            </div>
          </>
        )}

        {/* SUBSCRIBED TAB */}
        {activeTab === 'subscribed' && (
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-4">
            {!selectedPodcast ? (
              <>
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-3">
                  <div>
                    <h3 className="text-sm font-bold text-white flex items-center gap-2">
                      <Rss className="w-4 h-4 text-emerald-400" />
                      Subscribed Podcasts ({subscriptions.length})
                    </h3>
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      Tap any show to browse its last 60 episodes • Last checked: <span className="text-slate-300 font-medium">{lastFeedCheck}</span>
                    </p>
                  </div>

                  <button
                    onClick={checkNewEpisodesForSubscriptions}
                    disabled={isUpdatingFeeds || subscriptions.length === 0}
                    className="px-3.5 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-slate-950 font-bold text-xs flex items-center gap-1.5 shadow shrink-0"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isUpdatingFeeds ? 'animate-spin' : ''}`} />
                    {isUpdatingFeeds ? 'Checking Feeds...' : 'Check for New Episodes'}
                  </button>
                </div>

                {isUpdatingFeeds && feedUpdateProgress && (
                  <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs flex items-center gap-2">
                    <RefreshCw className="w-4 h-4 animate-spin shrink-0" />
                    <span className="truncate">{feedUpdateProgress}</span>
                  </div>
                )}

                {subscriptions.length === 0 ? (
                  <div className="text-center py-8 space-y-3">
                    <p className="text-xs text-slate-400">You haven't subscribed to any podcasts yet.</p>
                    <div className="flex flex-wrap justify-center gap-2">
                      <button
                        onClick={() => setActiveTab('discover')}
                        className="px-3.5 py-2 rounded-xl bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-xs font-semibold"
                      >
                        Search Shows to Subscribe
                      </button>
                      <button
                        onClick={() => setActiveTab('import')}
                        className="px-3.5 py-2 rounded-xl bg-slate-800 text-slate-200 border border-slate-700 text-xs font-semibold"
                      >
                        Import OPML File
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    {subscriptions.map(sub => (
                      <div
                        key={sub.id}
                        onClick={() => openPodcastShowView(sub, false)}
                        className="p-3 rounded-xl bg-slate-950 hover:bg-slate-900 border border-slate-800 cursor-pointer flex items-center justify-between gap-3 transition"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <img
                            src={sub.artwork || DEFAULT_ARTWORK}
                            alt=""
                            className="w-12 h-12 rounded-xl object-cover border border-slate-800 shrink-0"
                          />
                          <div className="min-w-0">
                            <div className="text-sm font-bold text-white truncate">{sub.title}</div>
                            <div className="text-[11px] text-emerald-400 font-medium mt-0.5">
                              {sub.episodeCount ? `${sub.episodeCount} episodes cached • Tap to open` : 'Tap to load last 60 episodes'}
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            onClick={(e) => toggleSubscription(sub, e)}
                            className="p-2 rounded-lg bg-slate-800/80 hover:bg-rose-500/20 text-slate-400 hover:text-rose-300"
                            title="Unsubscribe"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                          <ChevronRight className="w-4 h-4 text-slate-400" />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <div className="space-y-4">
                <div className="flex items-center justify-between border-b border-slate-800 pb-3 gap-2">
                  <button
                    onClick={() => setSelectedPodcast(null)}
                    className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold flex items-center gap-1.5"
                  >
                    <ArrowLeft className="w-4 h-4" />
                    Back to Subscribed
                  </button>

                  <button
                    onClick={() => openPodcastShowView(selectedPodcast, true)}
                    disabled={isLoadingShowEps}
                    className="px-3 py-1.5 rounded-xl bg-emerald-500/20 border border-emerald-500/30 text-emerald-300 text-xs font-semibold flex items-center gap-1.5"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isLoadingShowEps ? 'animate-spin' : ''}`} />
                    Refresh Feed
                  </button>
                </div>

                <div className="flex items-center gap-3">
                  <img
                    src={selectedPodcast.artwork || DEFAULT_ARTWORK}
                    alt=""
                    className="w-16 h-16 rounded-xl object-cover border border-slate-700 shrink-0"
                  />
                  <div className="min-w-0">
                    <h3 className="text-base font-bold text-white leading-snug">{selectedPodcast.title}</h3>
                    <p className="text-xs text-emerald-400 mt-0.5">
                      Showing {selectedPodcastEpisodes.length} episodes from RSS feed
                    </p>
                  </div>
                </div>

                <input
                  type="text"
                  value={episodeFilterQuery}
                  onChange={e => setEpisodeFilterQuery(e.target.value)}
                  placeholder="Filter episodes in this podcast..."
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white"
                />

                {isLoadingShowEps ? (
                  <div className="py-12 text-center space-y-2">
                    <RefreshCw className="w-6 h-6 animate-spin text-emerald-400 mx-auto" />
                    <p className="text-xs text-slate-400">Fetching up to 60 episodes from RSS feed...</p>
                  </div>
                ) : (
                  <div className="space-y-2.5 max-h-[62vh] overflow-y-auto pr-1">
                    {filteredShowEpisodes.map((ep, idx) => {
                      const isSaved = offlineIds.includes(ep.id);
                      const isPlayingThis = currentEp?.audioUrl === ep.audioUrl;
                      return (
                        <div
                          key={ep.id}
                          onClick={() => playEpisodeFromShow(ep)}
                          className={`p-3 rounded-xl border cursor-pointer flex items-center justify-between gap-3 transition ${
                            isPlayingThis
                              ? 'bg-emerald-500/15 border-emerald-500/40'
                              : 'bg-slate-950 hover:bg-slate-900 border-slate-800'
                          }`}
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 text-[10px] text-slate-400 font-mono">
                              <span>#{idx + 1}</span>
                              {ep.pubDate && <span>• {formatShortDate(ep.pubDate)}</span>}
                              {ep.duration > 0 && <span>• {formatTime(ep.duration)}</span>}
                              {isSaved && <span className="text-emerald-400 font-semibold">• Offline</span>}
                            </div>
                            <div className="text-xs font-bold text-white mt-0.5 line-clamp-2">{ep.title}</div>
                            {ep.rawNotes && (
                              <p className="text-[11px] text-slate-400 line-clamp-1 mt-1">{ep.rawNotes}</p>
                            )}
                          </div>

                          <div className="flex items-center gap-1.5 shrink-0">
                            <button
                              onClick={(e) => addEpisodeToQueue(ep, e)}
                              className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300"
                              title="Add to Queue"
                            >
                              <ListPlus className="w-4 h-4" />
                            </button>
                            <button
                              onClick={(e) => handleToggleOfflineDownload(ep, e)}
                              className={`p-2 rounded-lg border ${
                                isSaved
                                  ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300'
                                  : 'bg-slate-800 border-slate-700 text-slate-300'
                              }`}
                              title="Download Offline"
                            >
                              {downloadingId === ep.id ? (
                                <RefreshCw className="w-4 h-4 animate-spin" />
                              ) : isSaved ? (
                                <CheckCircle2 className="w-4 h-4" />
                              ) : (
                                <Download className="w-4 h-4" />
                              )}
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* DISCOVER TAB */}
        {activeTab === 'discover' && (
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-4">
            <div>
              <h3 className="text-sm font-bold text-white">Search Podcast Directory</h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Search for any podcast to subscribe and browse its last 60 episodes.
              </p>
            </div>

            <form onSubmit={handlePodcastSearch} className="flex gap-2">
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Search e.g. Cults, Darknet Diaries..."
                className="flex-1 bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white"
              />
              <button
                type="submit"
                disabled={isSearching}
                className="px-4 py-2 rounded-xl bg-emerald-500 text-slate-950 font-bold text-xs flex items-center gap-1.5 shrink-0"
              >
                <Search className="w-4 h-4" />
                {isSearching ? 'Searching...' : 'Search'}
              </button>
            </form>

            <div className="space-y-2.5">
              {searchResults.map(pod => {
                const subbed = isSubscribed(pod.feedUrl);
                return (
                  <div
                    key={pod.collectionId}
                    className="p-3 rounded-xl bg-slate-950 border border-slate-800 flex items-center justify-between gap-3"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <img
                        src={pod.artworkUrl600 || pod.artworkUrl100 || DEFAULT_ARTWORK}
                        alt=""
                        className="w-12 h-12 rounded-lg object-cover shrink-0"
                      />
                      <div className="min-w-0">
                        <div className="text-sm font-bold text-white truncate">{pod.collectionName}</div>
                        <div className="text-xs text-slate-400 truncate">{pod.artistName}</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        onClick={(e) =>
                          toggleSubscription({
                            title: pod.collectionName,
                            author: pod.artistName,
                            feedUrl: pod.feedUrl,
                            artwork: pod.artworkUrl600 || pod.artworkUrl100
                          }, e)
                        }
                        disabled={!pod.feedUrl}
                        className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1 border ${
                          subbed
                            ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300'
                            : 'bg-emerald-500 text-slate-950 border-emerald-400 font-bold'
                        }`}
                      >
                        {subbed ? <Check className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
                        {subbed ? 'Subscribed' : 'Subscribe'}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* QUEUE EDITOR TAB */}
        {activeTab === 'episodes' && (
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3">
            <div className="flex items-center justify-between gap-2 border-b border-slate-800 pb-3">
              <div>
                <h3 className="text-sm font-bold text-white">Playback Queue ({episodes.length})</h3>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  Tracks play in order from top to bottom • {offlineIds.length} downloaded offline
                </p>
              </div>
              {episodes.length > 1 && (
                <button
                  onClick={clearOtherQueueTracks}
                  className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-rose-500/20 text-slate-300 hover:text-rose-300 border border-slate-700 text-[11px] font-semibold flex items-center gap-1"
                >
                  <ListX className="w-3.5 h-3.5" />
                  Clear Others
                </button>
              )}
            </div>

            {episodes.map((ep, idx) => {
              const isSaved = offlineIds.includes(ep.id);
              const isActive = ep.id === currentEp?.id;
              return (
                <div
                  key={ep.id}
                  onClick={() => {
                    setCurrentEpId(ep.id);
                    setActiveTab('player');
                  }}
                  className={`p-3 rounded-xl border cursor-pointer flex items-center justify-between gap-2 ${
                    isActive
                      ? 'bg-emerald-500/10 border-emerald-500/40'
                      : 'bg-slate-950 border-slate-800'
                  }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span className="text-[11px] font-mono text-slate-500 w-5 text-center shrink-0">
                      {idx + 1}
                    </span>
                    <img
                      src={ep.artwork || DEFAULT_ARTWORK}
                      alt=""
                      className="w-11 h-11 rounded-lg object-cover shrink-0"
                    />
                    <div className="min-w-0">
                      <div className="text-xs text-emerald-400 font-medium truncate">
                        {isActive ? `Playing Now • ${ep.podcast}` : ep.podcast}
                      </div>
                      <div className="text-sm font-semibold text-white truncate">{ep.title}</div>
                      <div className="text-[11px] text-slate-400 mt-0.5 flex items-center gap-2">
                        <span>{ep.scanned ? `${ep.ads?.length || 0} ads flagged` : 'Tap to scan'}</span>
                        {isSaved && <span className="text-emerald-400 font-semibold">• Offline MP3</span>}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={(e) => moveQueueItem(idx, -1, e)}
                      disabled={idx === 0}
                      className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-30 text-slate-300"
                      title="Move up in queue"
                    >
                      <ArrowUp className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={(e) => moveQueueItem(idx, 1, e)}
                      disabled={idx === episodes.length - 1}
                      className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-30 text-slate-300"
                      title="Move down in queue"
                    >
                      <ArrowDown className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={(e) => handleToggleOfflineDownload(ep, e)}
                      className={`p-1.5 rounded-lg border ${
                        isSaved
                          ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300'
                          : 'bg-slate-800 border-slate-700 text-slate-300'
                      }`}
                      title={isSaved ? 'Remove offline download' : 'Download MP3 for offline use'}
                    >
                      {downloadingId === ep.id ? (
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      ) : isSaved ? (
                        <CheckCircle2 className="w-3.5 h-3.5" />
                      ) : (
                        <Download className="w-3.5 h-3.5" />
                      )}
                    </button>
                    {episodes.length > 1 && (
                      <button
                        onClick={(e) => deleteEpisodeFromQueue(ep.id, e)}
                        className="p-1.5 rounded-lg bg-slate-800/80 hover:bg-rose-500/20 text-slate-400 hover:text-rose-300"
                        title="Remove from queue"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* IMPORT TAB */}
        {activeTab === 'import' && (
          <div className="space-y-4">
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3">
              <div>
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <FolderUp className="w-4 h-4 text-emerald-400" />
                  OPML Subscription Import & Backup
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Import your entire subscribed podcast list from AntennaPod, Pocket Casts, or any `.opml` / `.xml` export.
                </p>
              </div>

              <input
                ref={opmlInputRef}
                type="file"
                accept=".opml,.xml,text/xml,application/xml,*/*"
                onChange={handleOpmlFileSelect}
                className="hidden"
              />

              <div className="flex flex-wrap gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => opmlInputRef.current?.click()}
                  className="px-4 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs flex items-center gap-2"
                >
                  <FolderUp className="w-4 h-4" />
                  Select .OPML / .XML File to Import
                </button>

                <button
                  type="button"
                  onClick={handleExportOpml}
                  className="px-3.5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-semibold text-xs flex items-center gap-2"
                >
                  <FileDown className="w-4 h-4 text-emerald-400" />
                  Export Subscriptions (.OPML)
                </button>
              </div>
            </div>

            <form onSubmit={handleManualImport} className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3">
              <h3 className="text-sm font-bold text-white">Add Single Podcast RSS URL or Direct MP3</h3>
              <div>
                <label className="block text-xs text-slate-400 mb-1">Podcast RSS Feed URL or Direct MP3 Stream *</label>
                <input
                  type="url"
                  required
                  value={customAudioUrl}
                  onChange={e => setCustomAudioUrl(e.target.value)}
                  placeholder="https://feeds.simplecast.com/... or https://.../stream.mp3"
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">Custom Title (Optional)</label>
                <input
                  type="text"
                  value={customTitle}
                  onChange={e => setCustomTitle(e.target.value)}
                  placeholder="Leave blank if importing an RSS feed"
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white"
                />
              </div>
              {importStatus && <div className="text-xs text-emerald-400 font-medium">{importStatus}</div>}
              <button
                type="submit"
                disabled={isImportingRss}
                className="w-full py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-emerald-500/40 text-emerald-300 font-bold text-xs"
              >
                {isImportingRss ? 'Subscribing...' : 'Subscribe & Cache 60 Episodes'}
              </button>
            </form>
          </div>
        )}

        {/* SETTINGS TAB */}
        {activeTab === 'settings' && (
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-4">
            <h3 className="text-sm font-bold text-white">Audio & Gemini AI Settings</h3>
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
              <label className="block text-xs text-slate-400 mb-1">
                Gemini API Key (Used for Tri-Window Audio & Show-Notes Ad Analysis)
              </label>
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

      {/* Sticky Player Bar */}
      <div className="fixed bottom-0 left-0 right-0 bg-slate-900/95 backdrop-blur border-t border-slate-800 p-3 z-30">
        <div className="max-w-3xl mx-auto space-y-2">
          <div
            className="relative h-3 bg-slate-800 rounded-full overflow-hidden cursor-pointer"
            onClick={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
              seekTo(pct * (duration || 1));
            }}
          >
            <div
              className="absolute top-0 left-0 bottom-0 bg-emerald-500 transition-all"
              style={{ width: `${Math.min(100, (currentTime / (duration || 1)) * 100)}%` }}
            />
            {currentEp?.scanned &&
              currentEp.ads?.map(ad => (
                <div
                  key={ad.id}
                  style={{
                    left: `${Math.min(100, (ad.startTime / (duration || 1)) * 100)}%`,
                    width: `${Math.max(1, ((ad.endTime - ad.startTime) / (duration || 1)) * 100)}%`
                  }}
                  className={`absolute top-0 bottom-0 ${
                    ad.whitelisted ? 'bg-slate-500/50' : 'bg-amber-500/90'
                  }`}
                />
              ))}
          </div>

          <div className="flex items-center justify-between text-xs">
            <span className="font-mono text-slate-400">{formatTime(currentTime)}</span>
            <div className="flex items-center gap-4">
              <button onClick={() => seekTo(currentTime - 15)} className="p-1.5 text-slate-300 hover:text-white">
                <Rewind className="w-4 h-4" />
              </button>
              <button
                onClick={togglePlay}
                className="w-10 h-10 rounded-full bg-emerald-500 text-slate-950 flex items-center justify-center shadow"
              >
                {isPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5 ml-0.5" />}
              </button>
              <button onClick={() => seekTo(currentTime + 30)} className="p-1.5 text-slate-300 hover:text-white">
                <FastForward className="w-4 h-4" />
              </button>
              <button
                onClick={() => {
                  if (audioRef.current) {
                    audioRef.current.muted = !isMuted;
                    setIsMuted(!isMuted);
                  }
                }}
                className="p-1.5 text-slate-400 hover:text-white"
              >
                {isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
              </button>
            </div>
            <span className="font-mono text-slate-400">{formatTime(duration)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
