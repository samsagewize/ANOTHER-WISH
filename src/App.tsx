import React, { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  AlertTriangle,
  AtSign,
  Check,
  Clock,
  Code2,
  Coins,
  ExternalLink,
  FileText,
  History,
  Image as ImageIcon,
  LogOut,
  MessageCircle,
  Music,
  Palette,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  Upload,
  User,
  Wallet,
  X,
} from 'lucide-react';
import { ChatMessage, FeeRates, FeeTier, Inscription, Profile, WalletType } from './types';
import { DEV_ADDR, SERVICE_FEE, fetchBalance, fetchFeeRates, fetchTxStatus, loadSatsConnect, toB64 } from './services/bitcoinService';
import { OperationType, auth, collection, db, doc, handleFirestoreError, limit, onSnapshot, orderBy, query, setDoc, updateDoc } from './firebase';
import { onAuthStateChanged, signInAnonymously } from 'firebase/auth';

const MAX_FILE_SIZE = 500 * 1024;
const MAX_FILE_SIZE_LABEL = '500KB';
const MUSEUM_RESET_AT = 1779425915000;
const ThreeWell = React.lazy(() => import('./components/ThreeWell').then((module) => ({ default: module.ThreeWell })));

const inscriptionId = (ins: Inscription) => (ins.wishTxid.includes('i') ? ins.wishTxid : `${ins.wishTxid}i0`);
const ordinalsContentUrl = (ins: Inscription) => `https://ordinals.com/content/${inscriptionId(ins)}`;
const ordIoUrl = (ins: Inscription) => `https://ord.io/${inscriptionId(ins)}`;

type BrcLookup = {
  ticker: string;
  info?: Record<string, any>;
  holders?: any[];
  source?: string;
  endpoints?: string[];
  setupNeeded?: boolean;
};

export default function App() {
  const [tab, setTab] = useState<'inscribe' | 'profile'>('inscribe');
  const [page, setPage] = useState<'home' | 'profile' | 'brc' | 'about'>(() => {
    if (window.location.pathname === '/profile') return 'profile';
    if (window.location.pathname === '/brc') return 'brc';
    if (window.location.pathname === '/about') return 'about';
    return 'home';
  });
  const [inscriptions, setInscriptions] = useState<Inscription[]>([]);
  const [selFile, setSelFile] = useState<File | null>(null);
  const [wishText, setWishText] = useState('');
  const [feeRates, setFeeRates] = useState<FeeRates>({ slow: 1, med: 2, fast: 4 });
  const [selRate, setSelRate] = useState<FeeTier>('med');
  const [customRate, setCustomRate] = useState(10);
  const [wallet, setWallet] = useState<{ type: WalletType; ordAddr: string; payAddr: string; balance: number } | null>(null);
  const [profiles, setProfiles] = useState<Record<string, Profile>>({});
  const [profileDraft, setProfileDraft] = useState({ displayName: '', avatarUrl: '', twitterUrl: '', bio: '' });
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatText, setChatText] = useState('');
  const [status, setStatus] = useState<{ type: 'ok' | 'err' | 'info'; msg: string } | null>(null);
  const [progress, setProgress] = useState<{ p: number; l: string } | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);
  const [showWalletSelect, setShowWalletSelect] = useState(false);
  const [showCongrats, setShowCongrats] = useState(false);
  const [lastTxid, setLastTxid] = useState('');
  const [historySearch, setHistorySearch] = useState('');
  const [brcTicker, setBrcTicker] = useState('ordi');
  const [brcLookup, setBrcLookup] = useState<BrcLookup | null>(null);
  const [brcLoading, setBrcLoading] = useState(false);
  const [brcError, setBrcError] = useState('');

  useEffect(() => {
    const syncPage = () => {
      if (window.location.pathname === '/profile') setPage('profile');
      else if (window.location.pathname === '/brc') setPage('brc');
      else if (window.location.pathname === '/about') setPage('about');
      else setPage('home');
    };
    window.addEventListener('popstate', syncPage);
    return () => window.removeEventListener('popstate', syncPage);
  }, []);

  useEffect(() => {
    fetchFeeRates().then(setFeeRates);

    const unsubAuth = onAuthStateChanged(auth, (u) => {
      if (!u) {
        signInAnonymously(auth).catch((err) => {
          if (err.code === 'auth/admin-restricted-operation') {
            console.warn('Anonymous Auth is disabled in Firebase Console. Security features are limited.');
          } else {
            console.error('Auth failed:', err);
          }
        });
      }
    });

    const q = query(collection(db, 'inscriptions'), orderBy('timestamp', 'desc'), limit(150));
    const unsubSnap = onSnapshot(q, (snapshot) => {
      setInscriptions(snapshot.docs
        .map((d) => d.data() as Inscription)
        .filter((ins) => ins.timestamp >= MUSEUM_RESET_AT && !ins.isDemo));
    }, (err) => {
      handleFirestoreError(err, OperationType.LIST, 'inscriptions');
    });

    const profileSnap = onSnapshot(collection(db, 'profiles'), (snapshot) => {
      const next: Record<string, Profile> = {};
      snapshot.docs.forEach((d) => {
        const profile = d.data() as Profile;
        next[profile.address] = profile;
      });
      setProfiles(next);
    }, (err) => {
      handleFirestoreError(err, OperationType.LIST, 'profiles');
    });

    const messagesQ = query(collection(db, 'messages'), orderBy('timestamp', 'desc'), limit(80));
    const messageSnap = onSnapshot(messagesQ, (snapshot) => {
      setChatMessages(snapshot.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<ChatMessage, 'id'>) })));
    }, (err) => {
      handleFirestoreError(err, OperationType.LIST, 'messages');
    });

    return () => {
      unsubAuth();
      unsubSnap();
      profileSnap();
      messageSnap();
    };
  }, []);

  useEffect(() => {
    const checkStatuses = async () => {
      const pending = inscriptions.filter((ins) => ins.status === 'pending' || !ins.status);
      if (!pending.length) return;

      for (const ins of pending) {
        try {
          const newStatus = await fetchTxStatus(ins.wishTxid);
          if (newStatus !== ins.status) {
            await updateDoc(doc(db, 'inscriptions', ins.wishTxid), { status: newStatus });
          }
        } catch (e) {
          console.error('Status check failed for', ins.wishTxid, e);
        }
      }
    };

    const timer = setInterval(checkStatuses, 60000);
    checkStatuses();
    return () => clearInterval(timer);
  }, [inscriptions]);

  useEffect(() => {
    if (!wallet) {
      setProfileDraft({ displayName: '', avatarUrl: '', twitterUrl: '', bio: '' });
      return;
    }

    const profile = profiles[wallet.ordAddr];
    setProfileDraft({
      displayName: profile?.displayName || '',
      avatarUrl: profile?.avatarUrl || '',
      twitterUrl: profile?.twitterUrl || '',
      bio: profile?.bio || '',
    });
  }, [profiles, wallet]);

  const goHome = () => {
    window.history.pushState({}, '', '/');
    setPage('home');
  };

  const goProfile = () => {
    if (!wallet) {
      setShowWalletSelect(true);
      return;
    }
    window.history.pushState({}, '', '/profile');
    setPage('profile');
  };

  const goBrc = () => {
    window.history.pushState({}, '', '/brc');
    setPage('brc');
  };

  const goAbout = () => {
    window.history.pushState({}, '', '/about');
    setPage('about');
  };

  const goInscribe = () => {
    window.history.pushState({}, '', '/');
    setPage('home');
    setTab('inscribe');
  };

  const lookupBrcTicker = async (tickerValue = brcTicker) => {
    const cleanTicker = tickerValue.trim();
    if (!/^[A-Za-z0-9]{4}$/.test(cleanTicker)) {
      setBrcError('Use exactly 4 letters or numbers for original BRC-20 tickers.');
      setBrcLookup(null);
      return;
    }

    setBrcLoading(true);
    setBrcError('');
    try {
      const res = await fetch(`/api/brc20/${encodeURIComponent(cleanTicker.toLowerCase())}`);
      const payload = await res.json();
      if (!res.ok) {
        throw new Error(payload.error || 'Could not load BRC-20 data.');
      }
      setBrcLookup(payload);
    } catch (err: any) {
      setBrcError(err.message || 'Could not load BRC-20 data.');
      setBrcLookup(null);
    } finally {
      setBrcLoading(false);
    }
  };

  const currentRate = selRate === 'custom' ? customRate : feeRates[selRate];
  const contentBytes = selFile ? selFile.size : new TextEncoder().encode(wishText).length;
  const vBytes = Math.max(160, Math.round(320 + contentBytes / 4));
  const netFee = vBytes * currentRate;
  const totalFee = netFee + SERVICE_FEE;
  const canInscribe = Boolean(wallet && (selFile || wishText.trim()) && !progress);

  const walletInscriptions = useMemo(() => {
    if (!wallet) return [];
    return inscriptions.filter((ins) => ins.address === wallet.ordAddr);
  }, [inscriptions, wallet]);

  const filteredWalletInscriptions = useMemo(() => {
    const search = historySearch.trim().toLowerCase();
    if (!search) return walletInscriptions;
    return walletInscriptions.filter((ins) => (
      ins.wish.toLowerCase().includes(search)
      || ins.wishTxid.toLowerCase().includes(search)
      || inscriptionId(ins).toLowerCase().includes(search)
      || ins.contentType.toLowerCase().includes(search)
      || (ins.status || 'pending').toLowerCase().includes(search)
    ));
  }, [historySearch, walletInscriptions]);

  const publicGallery = useMemo(() => inscriptions, [inscriptions]);
  const confirmedCount = walletInscriptions.filter((ins) => ins.status === 'confirmed').length;
  const pendingCount = walletInscriptions.filter((ins) => ins.status === 'pending' || !ins.status).length;

  const disconnectWallet = () => {
    setWallet(null);
    setTab('inscribe');
    setStatus(null);
    setProgress(null);
  };

  const refreshBalance = async () => {
    if (!wallet) return;
    const bal = await fetchBalance(wallet.payAddr);
    setWallet({ ...wallet, balance: bal });
  };

  const connectXverse = async () => {
    try {
      setShowWalletSelect(false);
      const sc = await loadSatsConnect();
      const { request, AddressPurpose } = sc;
      const resp = await request('wallet_connect', {
        addresses: [AddressPurpose.Ordinals, AddressPurpose.Payment],
        message: 'Bitcoin Wishing Well - connect to inscribe on mainnet',
        network: 'Mainnet',
      });

      if (resp.status === 'success') {
        const addrs = resp.result.addresses;
        const ord = addrs.find((a: any) => a.purpose === AddressPurpose.Ordinals) || addrs[0];
        const pay = addrs.find((a: any) => a.purpose === AddressPurpose.Payment) || ord;
        const bal = await fetchBalance(pay.address);
        setWallet({ type: 'xverse', ordAddr: ord.address, payAddr: pay.address, balance: bal });
        setStatus({ type: 'ok', msg: 'Wallet connected safely. No transaction, signature, or service fee was requested.' });
      }
    } catch (err: any) {
      setStatus({ type: 'err', msg: 'Xverse connect failed: ' + err.message });
    }
  };

  const connectUnisat = async () => {
    try {
      setShowWalletSelect(false);
      const unisat = (window as any).unisat;
      if (!unisat) throw new Error('UniSat extension not detected.');
      const accounts = await unisat.requestAccounts();
      const bal = await unisat.getBalance();
      setWallet({ type: 'unisat', ordAddr: accounts[0], payAddr: accounts[0], balance: bal.total });
      setStatus({ type: 'ok', msg: 'UniSat connected safely. No transaction or signature was requested. Use Xverse for live inscriptions.' });
    } catch (err: any) {
      setStatus({ type: 'err', msg: 'UniSat connect failed: ' + err.message });
    }
  };

  const handleFile = (file: File) => {
    if (file.size > MAX_FILE_SIZE) {
      setStatus({ type: 'err', msg: `File is too large. Keep inscriptions under ${MAX_FILE_SIZE_LABEL} for this launch.` });
      return;
    }
    setSelFile(file);
    setStatus(null);
  };

  const saveProfile = async () => {
    if (!wallet) {
      setShowWalletSelect(true);
      return;
    }

    const twitterUrl = profileDraft.twitterUrl.trim();
    if (twitterUrl && !/^https:\/\/(x\.com|twitter\.com)\/[A-Za-z0-9_]{1,15}\/?$/.test(twitterUrl)) {
      setStatus({ type: 'err', msg: 'Use a valid X/Twitter profile link like https://x.com/username.' });
      return;
    }

    const avatarUrl = profileDraft.avatarUrl.trim();
    if (avatarUrl && !/^https:\/\/.+/i.test(avatarUrl)) {
      setStatus({ type: 'err', msg: 'Use a secure image URL starting with https:// for your profile picture.' });
      return;
    }

    const profile: Profile = {
      address: wallet.ordAddr,
      displayName: profileDraft.displayName.trim() || `${wallet.ordAddr.slice(0, 6)}...${wallet.ordAddr.slice(-4)}`,
      avatarUrl,
      twitterUrl,
      bio: profileDraft.bio.trim(),
      verifiedAt: profiles[wallet.ordAddr]?.verifiedAt || Date.now(),
      updatedAt: Date.now(),
    };

    await setDoc(doc(db, 'profiles', wallet.ordAddr), profile);
    setStatus({ type: 'ok', msg: 'Profile saved. Your Twitter link is now attached to this ordinal wallet.' });
  };

  const sendMessage = async () => {
    if (!wallet) {
      setShowWalletSelect(true);
      return;
    }

    const text = chatText.trim();
    if (!text) return;
    if (text.length > 280) {
      setStatus({ type: 'err', msg: 'Museum chat messages must be 280 characters or less.' });
      return;
    }

    const messageRef = doc(collection(db, 'messages'));
    await setDoc(messageRef, {
      address: wallet.ordAddr,
      text,
      timestamp: Date.now(),
    });
    setChatText('');
  };

  const executeInscribe = async () => {
    if (!wallet) {
      setShowWalletSelect(true);
      return;
    }

    setProgress({ p: 0, l: 'Preparing inscription...' });
    try {
      let contentType: string;
      let contentB64: string;

      if (selFile) {
        const rawB64 = await toB64(selFile);
        if (wishText.trim()) {
          const meta = {
            wish: wishText.trim(),
            fileName: selFile.name,
            fileType: selFile.type,
            fileData: rawB64,
            app: 'bitcoin-wishing-well-v2',
            serviceFee: SERVICE_FEE,
          };
          contentType = 'application/json';
          contentB64 = btoa(JSON.stringify(meta));
        } else {
          contentType = selFile.type || 'application/octet-stream';
          contentB64 = rawB64;
        }
      } else {
        contentType = 'text/plain;charset=utf-8';
        contentB64 = btoa(unescape(encodeURIComponent(wishText.trim())));
      }

      setProgress({ p: 35, l: 'Confirm in wallet...' });

      let result;
      if (wallet.type === 'xverse') {
        const sc = await loadSatsConnect();
        const { createInscription } = sc;
        result = await new Promise<any>((resolve, reject) => {
          createInscription({
            payload: {
              network: { type: 'Mainnet' },
              contentType,
              content: contentB64,
              payloadType: 'BASE_64',
              appFee: SERVICE_FEE,
              appFeeAddress: DEV_ADDR,
              suggestedMinerFeeRate: currentRate,
            },
            onFinish: (resp: any) => resolve({ wishTxid: resp.txId, regTxid: null }),
            onCancel: () => reject(new Error('Cancelled')),
          });
        });
      } else {
        throw new Error('UniSat inscription requires API key integration. Please use Xverse for live inscriptions.');
      }

      const newIns: Inscription = {
        wish: wishText.trim() || (selFile ? `[file: ${selFile.name}]` : ''),
        contentType,
        wishTxid: result.wishTxid,
        regTxid: result.regTxid,
        address: wallet.ordAddr,
        timestamp: Date.now(),
        serviceFee: SERVICE_FEE,
        feeRate: currentRate,
        status: 'pending',
        creatorUid: wallet.ordAddr,
        contentB64: contentType.startsWith('image/') ? contentB64 : undefined,
      };

      setProgress({ p: 76, l: 'Saving to profile history...' });

      try {
        await setDoc(doc(db, 'inscriptions', newIns.wishTxid), newIns);

        await fetch('/api/track', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(newIns),
        });
      } catch (err) {
        console.error('Tracking error:', err);
      }

      setLastTxid(newIns.wishTxid);
      setStatus({ type: 'ok', msg: `Inscription ID ${inscriptionId(newIns)} is now indexing on your profile and the public museum.` });
      setShowCongrats(true);
      setProgress(null);
      setTab('profile');
      window.history.pushState({}, '', '/profile');
      setPage('profile');
      setWishText('');
      setSelFile(null);
      refreshBalance();
    } catch (err: any) {
      setStatus({ type: 'err', msg: 'Failed: ' + err.message });
      setProgress(null);
    }
  };

  const handleInscribe = () => {
    if (!wallet) {
      setShowWalletSelect(true);
      return;
    }
    if (!selFile && !wishText.trim()) {
      setStatus({ type: 'err', msg: 'Add text or upload a file before inscribing.' });
      return;
    }
    setShowConfirm(true);
  };

  return (
    <div className="min-h-screen bg-[#050403] text-[#e8d5a3] font-lora selection:bg-[#f5c842] selection:text-black">
      <div className="fixed inset-0 pointer-events-none bg-[radial-gradient(circle_at_22%_12%,rgba(245,200,66,0.14),transparent_32%),radial-gradient(circle_at_80%_18%,rgba(80,168,96,0.08),transparent_28%),linear-gradient(180deg,#070401_0%,#0f0803_55%,#030201_100%)]" />

      <nav className="sticky top-0 z-[9999] border-b border-[#3a2808]/80 bg-[#070401]/92 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <a href="/" className="nav-logo font-cinzel-decorative text-sm tracking-widest text-[#f5c842] sm:text-base">
            Bitcoin Wishing Well
          </a>
          <div className="flex items-center gap-2">
            <button onClick={goHome} className={`hidden rounded-lg border px-3 py-2 font-cinzel text-[0.62rem] font-bold uppercase tracking-widest transition sm:block ${page === 'home' ? 'border-[#f5c842]/35 bg-[#f5c842]/10 text-[#f5c842]' : 'border-[#3a2808] bg-black/35 text-[#7a5a25] hover:text-[#c9a040]'}`}>
              Home
            </button>
            <button onClick={goProfile} className={`hidden rounded-lg border px-3 py-2 font-cinzel text-[0.62rem] font-bold uppercase tracking-widest transition sm:block ${page === 'profile' ? 'border-[#f5c842]/35 bg-[#f5c842]/10 text-[#f5c842]' : 'border-[#3a2808] bg-black/35 text-[#7a5a25] hover:text-[#c9a040]'}`}>
              Profile
            </button>
            <button onClick={goAbout} className={`hidden rounded-lg border px-3 py-2 font-cinzel text-[0.62rem] font-bold uppercase tracking-widest transition sm:block ${page === 'about' ? 'border-[#f5c842]/35 bg-[#f5c842]/10 text-[#f5c842]' : 'border-[#3a2808] bg-black/35 text-[#7a5a25] hover:text-[#c9a040]'}`}>
              About
            </button>
            <button onClick={goBrc} className={`hidden rounded-lg border px-3 py-2 font-cinzel text-[0.62rem] font-bold uppercase tracking-widest transition sm:block ${page === 'brc' ? 'border-[#f5c842]/35 bg-[#f5c842]/10 text-[#f5c842]' : 'border-[#3a2808] bg-black/35 text-[#7a5a25] hover:text-[#c9a040]'}`}>
              BRC
            </button>
            <span className="nav-live hidden items-center gap-2 rounded-full border border-[#50a860]/30 bg-[#50a860]/10 px-3 py-1 font-cinzel text-[0.62rem] font-bold uppercase tracking-widest text-[#70d080] sm:flex">
              Mainnet
            </span>
            {!wallet ? (
              <button onClick={() => setShowWalletSelect(true)} className="inline-flex items-center gap-2 rounded-lg border border-[#f5c842]/35 bg-[#f5c842]/10 px-4 py-2 font-cinzel text-[0.68rem] font-bold uppercase tracking-widest text-[#f5c842] transition hover:bg-[#f5c842]/18">
                <Wallet size={15} /> Connect
              </button>
            ) : (
              <div className="flex items-center gap-2">
                <button onClick={goProfile} className="hidden rounded-lg border border-[#3a2808] bg-black/35 px-3 py-2 font-mono text-[0.72rem] text-[#c9a040] transition hover:border-[#f5c842]/40 sm:block">
                  {wallet.ordAddr.slice(0, 5)}...{wallet.ordAddr.slice(-5)}
                </button>
                <button onClick={disconnectWallet} className="rounded-lg border border-[#3a2808] bg-black/35 p-2 text-[#7a5a25] transition hover:text-[#cc6060]" aria-label="Disconnect wallet">
                  <LogOut size={16} />
                </button>
              </div>
            )}
          </div>
        </div>
      </nav>

      <BottomAppNav
        page={page}
        tab={tab}
        walletCount={walletInscriptions.length}
        onHome={goHome}
        onInscribe={goInscribe}
        onProfile={goProfile}
        onAbout={goAbout}
        onBrc={goBrc}
      />

      {page === 'profile' ? (
        <ProfilePage
          wallet={wallet}
          profile={wallet ? profiles[wallet.ordAddr] : undefined}
          draft={profileDraft}
          inscriptions={walletInscriptions}
          search={historySearch}
          status={status}
          profiles={profiles}
          onDraft={setProfileDraft}
          onSave={saveProfile}
          onSearch={setHistorySearch}
          onConnect={() => setShowWalletSelect(true)}
          onHome={goHome}
          onCast={() => {
            goHome();
            setTab('inscribe');
          }}
        />
      ) : page === 'brc' ? (
        <BrcPage
          ticker={brcTicker}
          lookup={brcLookup}
          loading={brcLoading}
          error={brcError}
          onTicker={setBrcTicker}
          onLookup={lookupBrcTicker}
          onHome={goHome}
        />
      ) : page === 'about' ? (
        <AboutPage
          onHome={goHome}
          onCast={() => {
            goHome();
            setTab('inscribe');
          }}
        />
      ) : (
      <main className="relative z-10 mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:py-8">
        <section className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_430px] lg:items-stretch">
          <div className="overflow-hidden rounded-[28px] border border-[#3a2808] bg-[#100904]/88 shadow-[0_24px_90px_rgba(0,0,0,0.42)]">
            <div className="grid min-h-[520px] lg:grid-cols-[minmax(0,0.95fr)_minmax(360px,1.05fr)]">
              <div className="relative min-h-[320px] overflow-hidden bg-black lg:min-h-full">
                <React.Suspense fallback={<div className="h-full min-h-[320px] bg-[radial-gradient(circle_at_center,#1a1208,#020202_70%)]" />}>
                  <ThreeWell onPlunge={() => setTab('inscribe')} compact />
                </React.Suspense>
                <div className="well-welcome pointer-events-none absolute inset-0 z-10 flex items-end justify-center p-6">
                  <span className="falling-wish-token">wish</span>
                  <div className="rounded-2xl border border-[#f5c842]/30 bg-black/55 px-5 py-3 text-center shadow-[0_0_34px_rgba(245,200,66,0.16)] backdrop-blur-sm">
                    <p className="font-cinzel-decorative text-lg tracking-widest text-[#f5c842] sm:text-xl">Welcome to the Wishing Well</p>
                    <p className="mt-1 font-cinzel text-[0.58rem] uppercase tracking-[0.2em] text-[#9c793c]">fall in, inscribe, index forever</p>
                  </div>
                </div>
                <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-black/10 via-transparent to-[#100904] lg:bg-gradient-to-r" />
              </div>

              <div className="flex flex-col justify-center p-6 sm:p-8">
                <div className="mb-5 inline-flex w-fit items-center gap-2 rounded-full border border-[#f5c842]/20 bg-[#f5c842]/8 px-3 py-1 font-cinzel text-[0.62rem] uppercase tracking-[0.22em] text-[#c9a040]">
                  <ShieldCheck size={13} /> Bitcoin Ordinals
                </div>
                <h1 className="font-cinzel-decorative text-[clamp(2rem,5vw,4.2rem)] leading-tight tracking-widest text-[#f5c842]">
                  Welcome to the Wishing Well
                </h1>
                <p className="mt-4 max-w-xl text-[1rem] leading-8 text-[#b89655]">
                  Drop code, images, songs, and art into Bitcoin. Every wish made here is indexed to your ordinal profile and the public museum with a visible inscription ID.
                </p>
                <div className="mt-5 flex flex-wrap gap-2">
                  <Pill icon={<Code2 size={13} />} label="Code" />
                  <Pill icon={<ImageIcon size={13} />} label="Images" />
                  <Pill icon={<Music size={13} />} label="Songs" />
                  <Pill icon={<Palette size={13} />} label="Art" />
                </div>

                <div className="mt-7 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  <Stat label="Profiles reached" value={Object.keys(profiles).length.toLocaleString()} />
                  <Stat label="Wishing Well" value={inscriptions.length.toLocaleString()} />
                  <Stat label="Your history" value={wallet ? walletInscriptions.length.toLocaleString() : '--'} />
                  <Stat label="Fee rate" value={`${currentRate} s/vB`} />
                </div>

                <div className="mt-7 flex flex-col gap-3 sm:flex-row">
                  <button onClick={() => setTab('inscribe')} className="rounded-xl bg-gradient-to-r from-[#f5c842] to-[#c9a040] px-5 py-3 font-cinzel text-[0.75rem] font-bold uppercase tracking-[0.18em] text-black shadow-[0_0_28px_rgba(245,200,66,0.22)] transition hover:brightness-110">
                    Start Inscribing
                  </button>
                  <button onClick={goProfile} className="rounded-xl border border-[#3a2808] bg-black/35 px-5 py-3 font-cinzel text-[0.75rem] font-bold uppercase tracking-[0.18em] text-[#c9a040] transition hover:border-[#f5c842]/35 hover:text-[#f5c842]">
                    View Profile History
                  </button>
                </div>
              </div>
            </div>
          </div>

          <aside className="grid gap-4">
            <ProfileSummary
              wallet={wallet}
              profile={wallet ? profiles[wallet.ordAddr] : undefined}
              draft={profileDraft}
              total={walletInscriptions.length}
              confirmed={confirmedCount}
              pending={pendingCount}
              balance={wallet?.balance || 0}
              onConnect={() => setShowWalletSelect(true)}
              onRefresh={refreshBalance}
              onDraft={setProfileDraft}
              onSave={saveProfile}
            />
            <SafetyPanel />
          </aside>
        </section>

        <section className="mt-6 grid gap-5 lg:grid-cols-[minmax(0,0.98fr)_minmax(360px,0.72fr)]">
          <div className="rounded-2xl border border-[#3a2808] bg-[#100904]/88 p-4 shadow-[0_20px_70px_rgba(0,0,0,0.28)] sm:p-5">
            <div className="mb-5 grid grid-cols-2 gap-2 rounded-xl border border-[#221508] bg-black/35 p-1">
              <button onClick={() => setTab('inscribe')} className={`flex items-center justify-center gap-2 rounded-lg py-2.5 font-cinzel text-[0.7rem] font-bold uppercase tracking-widest transition ${tab === 'inscribe' ? 'border border-[#f5c842]/25 bg-[#f5c842]/12 text-[#f5c842]' : 'text-[#7a5a25] hover:text-[#c9a040]'}`}>
                <Coins size={15} /> Inscribe
              </button>
              <button onClick={goProfile} className={`flex items-center justify-center gap-2 rounded-lg py-2.5 font-cinzel text-[0.7rem] font-bold uppercase tracking-widest transition ${tab === 'profile' ? 'border border-[#f5c842]/25 bg-[#f5c842]/12 text-[#f5c842]' : 'text-[#7a5a25] hover:text-[#c9a040]'}`}>
                <History size={15} /> Profile
                <span className="rounded-full border border-[#f5c842]/20 bg-[#f5c842]/10 px-1.5 text-[0.58rem] text-[#f5c842]">{walletInscriptions.length}</span>
              </button>
            </div>

            {tab === 'inscribe' ? (
              <InscribePanel
                selFile={selFile}
                wishText={wishText}
                feeRates={feeRates}
                selRate={selRate}
                customRate={customRate}
                wallet={wallet}
                status={status}
                progress={progress}
                contentBytes={contentBytes}
                netFee={netFee}
                totalFee={totalFee}
                canInscribe={canInscribe}
                onFile={handleFile}
                onRemoveFile={() => setSelFile(null)}
                onWishText={setWishText}
                onSelRate={setSelRate}
                onCustomRate={setCustomRate}
                maxFileSizeLabel={MAX_FILE_SIZE_LABEL}
                onConnect={() => setShowWalletSelect(true)}
                onDisconnect={disconnectWallet}
                onInscribe={handleInscribe}
              />
            ) : (
              <HistoryPanel
                wallet={wallet}
                search={historySearch}
                inscriptions={filteredWalletInscriptions}
                total={walletInscriptions.length}
                onSearch={setHistorySearch}
                onCast={() => setTab('inscribe')}
                onConnect={() => setShowWalletSelect(true)}
                profiles={profiles}
              />
            )}
          </div>

          <div className="grid gap-5">
            <MuseumGallery inscriptions={publicGallery} profiles={profiles} />
            <HowItWorks />
            <MuseumChat
              wallet={wallet}
              profiles={profiles}
              messages={chatMessages}
              text={chatText}
              onText={setChatText}
              onSend={sendMessage}
              onConnect={() => setShowWalletSelect(true)}
            />
          </div>
        </section>
      </main>
      )}

      <footer className="relative z-10 mx-auto max-w-7xl px-4 pb-10 pt-2 text-center sm:px-6">
        <div className="border-t border-[#3a2808]/60 pt-6 font-cinzel text-[0.62rem] uppercase leading-loose tracking-[0.18em] text-[#5f4218]">
          Bitcoin Wishing Well · Bitcoin Mainnet · Ordinals Protocol<br />
          <a href="https://x.com/SamSageWize" target="_blank" rel="noopener noreferrer" className="font-bold text-[#c9a040] transition hover:text-[#f5c842]">Founder: @SamSageWize</a>
        </div>
      </footer>

      <AnimatePresence>
        {showCongrats && (
          <SuccessModal lastTxid={lastTxid} onClose={() => setShowCongrats(false)} />
        )}

        {showWalletSelect && (
          <WalletModal onClose={() => setShowWalletSelect(false)} onXverse={connectXverse} onUnisat={connectUnisat} />
        )}

        {showConfirm && (
          <ConfirmModal
            selFile={selFile}
            wishText={wishText}
            selRate={selRate}
            currentRate={currentRate}
            netFee={netFee}
            totalFee={totalFee}
            onCancel={() => setShowConfirm(false)}
            onConfirm={() => {
              setShowConfirm(false);
              executeInscribe();
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function BottomAppNav({
  page,
  tab,
  walletCount,
  onHome,
  onInscribe,
  onProfile,
  onAbout,
  onBrc,
}: {
  page: 'home' | 'profile' | 'brc' | 'about';
  tab: 'inscribe' | 'profile';
  walletCount: number;
  onHome: () => void;
  onInscribe: () => void;
  onProfile: () => void;
  onAbout: () => void;
  onBrc: () => void;
}) {
  const items = [
    { label: 'Home', icon: <Sparkles size={18} />, active: page === 'home' && tab !== 'inscribe', onClick: onHome },
    { label: 'Inscribe', icon: <Coins size={18} />, active: page === 'home' && tab === 'inscribe', onClick: onInscribe },
    { label: 'Profile', icon: <History size={18} />, active: page === 'profile', onClick: onProfile, count: walletCount },
    { label: 'About', icon: <MessageCircle size={18} />, active: page === 'about', onClick: onAbout },
    { label: 'BRC', icon: <Search size={18} />, active: page === 'brc', onClick: onBrc },
  ];

  return (
    <nav className="bottom-app-nav fixed inset-x-0 bottom-0 z-[9998] border-t border-[#3a2808]/80 bg-[#070401]/94 px-2 py-2 backdrop-blur-xl" aria-label="App navigation">
      <div className="mx-auto grid max-w-2xl grid-cols-5 gap-1">
        {items.map((item) => (
          <button
            key={item.label}
            onClick={item.onClick}
            className={`relative flex min-w-0 flex-col items-center justify-center gap-1 rounded-2xl px-1 py-2 font-cinzel text-[0.55rem] font-bold uppercase tracking-wider transition ${item.active ? 'bg-[#f5c842]/12 text-[#f5c842]' : 'text-[#7a5a25] hover:bg-[#f5c842]/8 hover:text-[#c9a040]'}`}
          >
            {item.icon}
            <span className="truncate">{item.label}</span>
            {item.count ? (
              <span className="absolute right-2 top-1 rounded-full bg-[#f5c842] px-1.5 font-mono text-[0.5rem] text-black">{item.count}</span>
            ) : null}
          </button>
        ))}
      </div>
    </nav>
  );
}

const commercialSlides = [
  {
    kicker: '00-03 seconds',
    headline: 'Make a wish.',
    body: 'Start with words, art, music, code, or a tiny file worth preserving.',
  },
  {
    kicker: '03-06 seconds',
    headline: 'Drop it into Bitcoin.',
    body: 'WishOnBitcoin turns your idea into an ordinal inscription on the eternal ledger.',
  },
  {
    kicker: '06-09 seconds',
    headline: 'See the cost before you sign.',
    body: 'Review content size, fee speed, network fee, and service fee before your wallet prompt.',
  },
  {
    kicker: '09-12 seconds',
    headline: 'Get the inscription ID.',
    body: 'Every wish gets a visible ID so people can find it, verify it, and open it on-chain.',
  },
  {
    kicker: '12-15 seconds',
    headline: 'Build the museum.',
    body: 'Your profile history and the public museum index every wish made through the well.',
  },
];

function AboutPage({ onHome, onCast }: { onHome: () => void; onCast: () => void }) {
  const [activeSlide, setActiveSlide] = useState(0);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setActiveSlide((current) => (current + 1) % commercialSlides.length);
    }, 3000);
    return () => window.clearInterval(timer);
  }, []);

  const slide = commercialSlides[activeSlide];

  return (
    <main className="relative z-10 mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:py-8">
      <section className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_380px] lg:items-stretch">
        <div className="commercial-frame relative min-h-[620px] overflow-hidden rounded-[28px] border border-[#3a2808] bg-[#100904]/88 p-6 shadow-[0_24px_90px_rgba(0,0,0,0.42)] sm:p-8">
          <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(circle_at_50%_22%,rgba(245,200,66,0.18),transparent_26%),radial-gradient(circle_at_50%_78%,rgba(80,168,96,0.08),transparent_28%)]" />
          <div className="relative z-10 flex min-h-[560px] flex-col justify-between">
            <div className="flex items-center justify-between gap-3">
              <span className="rounded-full border border-[#f5c842]/25 bg-[#f5c842]/10 px-3 py-1 font-cinzel text-[0.62rem] font-bold uppercase tracking-[0.22em] text-[#f5c842]">
                15 second commercial
              </span>
              <span className="font-mono text-xs text-[#7a5a25]">{activeSlide + 1}/5</span>
            </div>

            <div className="mx-auto grid max-w-4xl gap-8 py-10 text-center">
              <div className="mx-auto grid h-24 w-24 place-items-center rounded-full border border-[#f5c842]/30 bg-black/40 shadow-[0_0_60px_rgba(245,200,66,0.18)]">
                <Coins className="text-[#f5c842]" size={38} />
              </div>
              <div key={activeSlide} className="commercial-slide">
                <p className="font-cinzel text-[0.68rem] font-bold uppercase tracking-[0.28em] text-[#9c793c]">{slide.kicker}</p>
                <h1 className="mt-5 font-cinzel-decorative text-[clamp(2.8rem,8vw,6.6rem)] leading-none tracking-widest text-[#f5c842]">
                  {slide.headline}
                </h1>
                <p className="mx-auto mt-6 max-w-2xl text-lg leading-8 text-[#c7a866]">
                  {slide.body}
                </p>
              </div>
            </div>

            <div className="grid gap-3">
              <div className="grid grid-cols-5 gap-2" aria-label="Commercial slide progress">
                {commercialSlides.map((item, index) => (
                  <button
                    key={item.headline}
                    onClick={() => setActiveSlide(index)}
                    className={`h-2 rounded-full transition ${index === activeSlide ? 'bg-[#f5c842]' : 'bg-[#3a2808]'}`}
                    aria-label={`Show slide ${index + 1}`}
                  />
                ))}
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-[#1a1008]">
                <div key={activeSlide} className="commercial-progress h-full bg-gradient-to-r from-[#c9a040] to-[#f5c842]" />
              </div>
            </div>
          </div>
        </div>

        <aside className="grid gap-5">
          <section className="rounded-[28px] border border-[#3a2808] bg-[#100904]/88 p-5 shadow-[0_24px_90px_rgba(0,0,0,0.42)]">
            <h2 className="font-cinzel-decorative text-2xl tracking-widest text-[#f5c842]">What is this?</h2>
            <p className="mt-4 text-sm leading-7 text-[#9c793c]">
              WishOnBitcoin is a Bitcoin inscription studio and social museum. It helps people preserve small creations on-chain, then indexes each inscription to a wallet profile and public museum.
            </p>
            <div className="mt-5 grid gap-3">
              <InfoLine label="Preserve" value="Text, art, music, code, and files" />
              <InfoLine label="Review" value="Fees and content before signing" />
              <InfoLine label="Index" value="Profile history plus public museum" />
            </div>
          </section>

          <section className="rounded-[28px] border border-[#3a2808] bg-[#100904]/88 p-5 shadow-[0_24px_90px_rgba(0,0,0,0.42)]">
            <h2 className="font-cinzel text-[0.78rem] font-bold uppercase tracking-widest text-[#f5c842]">Ready?</h2>
            <p className="mt-3 text-sm leading-7 text-[#9c793c]">Turn the commercial into an inscription. Start with one sentence or one tiny file.</p>
            <div className="mt-5 grid gap-3">
              <button onClick={onCast} className="rounded-xl bg-gradient-to-r from-[#f5c842] to-[#c9a040] px-5 py-3 font-cinzel text-[0.75rem] font-bold uppercase tracking-[0.18em] text-black transition hover:brightness-110">
                Start Inscribing
              </button>
              <button onClick={onHome} className="rounded-xl border border-[#3a2808] bg-black/35 px-5 py-3 font-cinzel text-[0.75rem] font-bold uppercase tracking-[0.18em] text-[#c9a040] transition hover:border-[#f5c842]/35 hover:text-[#f5c842]">
                Back Home
              </button>
            </div>
          </section>
        </aside>
      </section>
    </main>
  );
}

function InfoLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-[#2a1808] bg-black/25 p-4">
      <div className="font-cinzel text-[0.58rem] uppercase tracking-widest text-[#6f501f]">{label}</div>
      <div className="mt-1 text-sm text-[#d4a040]">{value}</div>
    </div>
  );
}

function BrcPage({ ticker, lookup, loading, error, onTicker, onLookup, onHome }: {
  ticker: string;
  lookup: BrcLookup | null;
  loading: boolean;
  error: string;
  onTicker: (value: string) => void;
  onLookup: (value?: string) => void;
  onHome: () => void;
}) {
  const cleanTicker = ticker.trim().toLowerCase();
  const validTicker = /^[A-Za-z0-9]{4}$/.test(cleanTicker);
  const info = lookup?.info || {};
  const minted = brcField(info, ['minted', 'totalMinted', 'mintedSupply']);
  const max = brcField(info, ['max', 'maxSupply', 'totalSupply']);
  const holders = brcField(info, ['holders', 'holderCount']);
  const transactions = brcField(info, ['transactions', 'txCount']);
  const deployer = brcField(info, ['deployer', 'deployBy', 'address', 'creator']);
  const deployInscription = brcField(info, ['inscriptionId', 'deployInscriptionId', 'deployInscription']);

  return (
    <main className="relative z-10 mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:py-8">
      <section className="grid gap-5 lg:grid-cols-[minmax(0,0.92fr)_420px]">
        <div className="rounded-[28px] border border-[#3a2808] bg-[#100904]/88 p-6 shadow-[0_24px_90px_rgba(0,0,0,0.42)] sm:p-8">
          <div className="mb-5 inline-flex w-fit items-center gap-2 rounded-full border border-[#f5c842]/20 bg-[#f5c842]/8 px-3 py-1 font-cinzel text-[0.62rem] uppercase tracking-[0.22em] text-[#c9a040]">
            <Coins size={13} /> Read-only BRC-20
          </div>
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h1 className="font-cinzel-decorative text-[clamp(2.2rem,5vw,4rem)] leading-tight tracking-widest text-[#f5c842]">BRC Viewer</h1>
              <p className="mt-4 max-w-2xl text-sm leading-7 text-[#b89655]">
                Explore original 4-character BRC-20 tickers using indexed Bitcoin protocol data. This page does not mint, transfer, list, or request wallet signatures.
              </p>
            </div>
            <button onClick={onHome} className="w-fit rounded-xl border border-[#3a2808] bg-black/35 px-5 py-3 font-cinzel text-[0.72rem] font-bold uppercase tracking-widest text-[#c9a040] transition hover:border-[#f5c842]/35 hover:text-[#f5c842]">
              Back Home
            </button>
          </div>

          <div className="mt-8 grid gap-3 rounded-2xl border border-[#2a1808] bg-black/35 p-3 sm:grid-cols-[1fr_auto]">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#7a5a25]" size={16} />
              <input
                value={ticker}
                onChange={(e) => onTicker(e.target.value.replace(/[^A-Za-z0-9]/g, '').slice(0, 4).toLowerCase())}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') onLookup();
                }}
                placeholder="ordi"
                maxLength={4}
                className="h-12 w-full rounded-xl border border-[#2a1808] bg-[#090502] pl-10 pr-4 font-mono text-lg uppercase tracking-[0.32em] text-[#f5c842] outline-none focus:border-[#c9a040]"
              />
            </div>
            <button
              onClick={() => onLookup()}
              disabled={!validTicker || loading}
              className="h-12 rounded-xl bg-gradient-to-r from-[#f5c842] to-[#c9a040] px-5 font-cinzel text-[0.72rem] font-bold uppercase tracking-widest text-black transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-45"
            >
              {loading ? 'Loading' : 'Lookup'}
            </button>
          </div>

          {(error || lookup?.setupNeeded) && (
            <div className="mt-4 rounded-2xl border border-[#7a4a18] bg-[#2a1605]/70 p-4 text-sm leading-6 text-[#d8a858]">
              {error || 'Add UNISAT_API_KEY in Vercel to enable live BRC-20 indexer data.'}
            </div>
          )}

          <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Stat label="Ticker" value={(lookup?.ticker || cleanTicker || '----').toUpperCase()} />
            <Stat label="Minted" value={formatBrcValue(minted)} />
            <Stat label="Max" value={formatBrcValue(max)} />
            <Stat label="Holders" value={formatBrcValue(holders)} />
          </div>

          <div className="mt-6 grid gap-5 lg:grid-cols-[1fr_0.85fr]">
            <section className="rounded-2xl border border-[#2a1808] bg-black/25 p-5">
              <div className="mb-4 flex items-center justify-between gap-3">
                <h2 className="font-cinzel text-[0.78rem] font-bold uppercase tracking-widest text-[#f5c842]">Token Snapshot</h2>
                {lookup?.source && <span className="rounded-full border border-[#50a860]/25 bg-[#50a860]/10 px-2 py-1 font-cinzel text-[0.55rem] uppercase tracking-widest text-[#70d080]">{lookup.source}</span>}
              </div>
              <div className="grid gap-3 text-sm">
                <BrcRow label="Deploy inscription" value={formatBrcValue(deployInscription)} href={deployInscription ? `https://ordinals.com/inscription/${deployInscription}` : undefined} />
                <BrcRow label="Deployer" value={formatBrcValue(deployer)} />
                <BrcRow label="Transactions" value={formatBrcValue(transactions)} />
                <BrcRow label="Limit per mint" value={formatBrcValue(brcField(info, ['lim', 'limit', 'mintLimit']))} />
                <BrcRow label="Decimals" value={formatBrcValue(brcField(info, ['decimal', 'decimals']))} />
              </div>
            </section>

            <section className="rounded-2xl border border-[#2a1808] bg-black/25 p-5">
              <h2 className="mb-4 font-cinzel text-[0.78rem] font-bold uppercase tracking-widest text-[#f5c842]">Top Holders</h2>
              {lookup?.holders?.length ? (
                <div className="space-y-2">
                  {lookup.holders.slice(0, 8).map((holder, index) => (
                    <div key={`${holder.address || index}`} className="flex items-center justify-between gap-3 rounded-xl border border-[#1f1408] bg-[#090502] px-3 py-2 text-sm">
                      <span className="min-w-0 truncate font-mono text-[#9c793c]">{holder.address || holder.owner || 'Unknown holder'}</span>
                      <span className="shrink-0 font-mono text-[#f5c842]">{formatBrcValue(holder.overallBalance || holder.balance || holder.amount)}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="rounded-xl border border-[#1f1408] bg-[#090502] p-4 text-sm leading-6 text-[#7a5a25]">Lookup a ticker to load holder data when the indexer is configured.</p>
              )}
            </section>
          </div>
        </div>

        <aside className="grid gap-4">
          <ProtocolCard title="BRC-20" body="Ticker info, balances, holders, and transfer history come from a protocol indexer. Original tickers use exactly 4 letters or numbers." active />
          <ProtocolCard title="Ordinals" body="Images and inscription content should resolve through ordinals.com/content/{inscriptionId} or ordinals.com/inscription/{inscriptionId}." />
          <ProtocolCard title="Runes" body="Runes can be displayed the same way through read-only indexer endpoints before we add any wallet actions." />
          <div className="rounded-2xl border border-[#2a1808] bg-[#100904]/88 p-5">
            <h2 className="font-cinzel text-[0.78rem] font-bold uppercase tracking-widest text-[#f5c842]">Safety</h2>
            <p className="mt-3 text-sm leading-6 text-[#8f6a2c]">This screen is view-only. No wallet transaction, PSBT, signature, mint, transfer, or listing can be created here.</p>
          </div>
        </aside>
      </section>
    </main>
  );
}

function ProtocolCard({ title, body, active }: { title: string; body: string; active?: boolean }) {
  return (
    <div className={`rounded-2xl border p-5 ${active ? 'border-[#f5c842]/25 bg-[#f5c842]/8' : 'border-[#2a1808] bg-[#100904]/88'}`}>
      <div className="mb-3 flex items-center gap-2 font-cinzel text-[0.72rem] font-bold uppercase tracking-widest text-[#f5c842]">
        <ShieldCheck size={14} /> {title}
      </div>
      <p className="text-sm leading-6 text-[#8f6a2c]">{body}</p>
    </div>
  );
}

function BrcRow({ label, value, href }: { label: string; value: string; href?: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-[#1f1408] bg-[#090502] px-3 py-2">
      <span className="shrink-0 font-cinzel text-[0.58rem] uppercase tracking-widest text-[#6f501f]">{label}</span>
      {href ? (
        <a href={href} target="_blank" rel="noopener noreferrer" className="min-w-0 truncate font-mono text-[#c9a040] transition hover:text-[#f5c842]">
          {value} <ExternalLink className="inline" size={10} />
        </a>
      ) : (
        <span className="min-w-0 truncate text-right font-mono text-[#c9a040]">{value}</span>
      )}
    </div>
  );
}

function brcField(source: Record<string, any>, keys: string[]) {
  for (const key of keys) {
    if (source[key] !== undefined && source[key] !== null && source[key] !== '') return source[key];
  }
  return undefined;
}

function formatBrcValue(value: any) {
  if (value === undefined || value === null || value === '') return '--';
  if (typeof value === 'number') return value.toLocaleString();
  const text = String(value);
  if (/^\d+$/.test(text)) return BigInt(text).toLocaleString();
  return /^\d+\.\d+$/.test(text) ? Number(text).toLocaleString() : text;
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-[#3a2808] bg-black/28 p-3">
      <div className="font-cinzel text-[0.58rem] uppercase tracking-[0.18em] text-[#6f501f]">{label}</div>
      <div className="mt-1 font-mono text-lg text-[#f5c842]">{value}</div>
    </div>
  );
}

function ProfilePage({ wallet, profile, draft, inscriptions, search, status, profiles, onDraft, onSave, onSearch, onConnect, onHome, onCast }: {
  wallet: { type: WalletType; ordAddr: string; payAddr: string; balance: number } | null;
  profile?: Profile;
  draft: { displayName: string; avatarUrl: string; twitterUrl: string; bio: string };
  inscriptions: Inscription[];
  search: string;
  status: { type: 'ok' | 'err' | 'info'; msg: string } | null;
  profiles: Record<string, Profile>;
  onDraft: (next: { displayName: string; avatarUrl: string; twitterUrl: string; bio: string }) => void;
  onSave: () => void;
  onSearch: (value: string) => void;
  onConnect: () => void;
  onHome: () => void;
  onCast: () => void;
}) {
  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return inscriptions;
    return inscriptions.filter((ins) => (
      ins.wish.toLowerCase().includes(term)
      || ins.wishTxid.toLowerCase().includes(term)
      || inscriptionId(ins).toLowerCase().includes(term)
      || ins.contentType.toLowerCase().includes(term)
      || (ins.status || 'pending').toLowerCase().includes(term)
    ));
  }, [inscriptions, search]);

  if (!wallet) {
    return (
      <main className="relative z-10 mx-auto max-w-5xl px-4 py-10 sm:px-6">
        <div className="rounded-[28px] border border-[#3a2808] bg-[#100904]/88 p-8 text-center shadow-[0_24px_90px_rgba(0,0,0,0.42)]">
          <User className="mx-auto mb-4 text-[#6f501f]" size={48} />
          <h1 className="font-cinzel-decorative text-3xl tracking-widest text-[#f5c842]">Wallet Profile</h1>
          <p className="mx-auto mt-4 max-w-xl text-sm leading-7 text-[#9c793c]">
            Connect your ordinal wallet to edit your picture and bio, link your Twitter, and see every Wishing Well inscription ID indexed to this profile.
          </p>
          <div className="mt-6 flex flex-col justify-center gap-3 sm:flex-row">
            <button onClick={onConnect} className="rounded-xl bg-[#f5c842] px-5 py-3 font-cinzel text-[0.72rem] font-bold uppercase tracking-widest text-black">Connect Wallet</button>
            <button onClick={onHome} className="rounded-xl border border-[#3a2808] px-5 py-3 font-cinzel text-[0.72rem] font-bold uppercase tracking-widest text-[#c9a040]">Back Home</button>
          </div>
        </div>
      </main>
    );
  }

  const displayName = profile?.displayName || `${wallet.ordAddr.slice(0, 6)}...${wallet.ordAddr.slice(-4)}`;
  const avatar = draft.avatarUrl || profile?.avatarUrl;

  return (
    <main className="relative z-10 mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:py-8">
      <section className="grid gap-5 lg:grid-cols-[380px_minmax(0,1fr)]">
        <aside className="rounded-[28px] border border-[#3a2808] bg-[#100904]/88 p-5 shadow-[0_24px_90px_rgba(0,0,0,0.42)]">
          <div className="mb-5 text-center">
            <div className="mx-auto mb-4 grid h-32 w-32 place-items-center overflow-hidden rounded-3xl border border-[#3a2808] bg-black/35">
              {avatar ? (
                <img src={avatar} alt="Profile avatar" className="h-full w-full object-cover" referrerPolicy="no-referrer" />
              ) : (
                <User className="text-[#6f501f]" size={46} />
              )}
            </div>
            <h1 className="font-cinzel-decorative text-2xl tracking-widest text-[#f5c842]">{displayName}</h1>
            <p className="mt-2 break-all font-mono text-[0.72rem] text-[#7a5a25]">{wallet.ordAddr}</p>
            {profile?.twitterUrl && (
              <a href={profile.twitterUrl} target="_blank" rel="noopener noreferrer" className="mt-3 inline-flex items-center gap-1 text-sm text-[#f5c842] hover:underline">
                <AtSign size={14} /> Twitter linked
              </a>
            )}
          </div>

          <div className="grid grid-cols-3 gap-2">
            <MiniStat label="Total" value={inscriptions.length.toString()} />
            <MiniStat label="Confirmed" value={inscriptions.filter((ins) => ins.status === 'confirmed').length.toString()} />
            <MiniStat label="Pending" value={inscriptions.filter((ins) => ins.status === 'pending' || !ins.status).length.toString()} />
          </div>

          <div className="mt-5 space-y-3 rounded-2xl border border-[#2a1808] bg-black/25 p-4">
            <h2 className="font-cinzel text-[0.72rem] font-bold uppercase tracking-widest text-[#f5c842]">Edit Profile</h2>
            <input value={draft.displayName} onChange={(e) => onDraft({ ...draft, displayName: e.target.value })} placeholder="Display name" maxLength={40} className="w-full rounded-xl border border-[#2a1808] bg-black/35 px-3 py-2 text-sm text-[#e8d5a3] outline-none focus:border-[#c9a040]" />
            <input value={draft.avatarUrl} onChange={(e) => onDraft({ ...draft, avatarUrl: e.target.value })} placeholder="Profile picture https:// URL" className="w-full rounded-xl border border-[#2a1808] bg-black/35 px-3 py-2 text-sm text-[#e8d5a3] outline-none focus:border-[#c9a040]" />
            <input value={draft.twitterUrl} onChange={(e) => onDraft({ ...draft, twitterUrl: e.target.value })} placeholder="https://x.com/username" className="w-full rounded-xl border border-[#2a1808] bg-black/35 px-3 py-2 text-sm text-[#e8d5a3] outline-none focus:border-[#c9a040]" />
            <textarea value={draft.bio} onChange={(e) => onDraft({ ...draft, bio: e.target.value })} placeholder="Bio for your ordinal wallet museum" maxLength={240} className="h-28 w-full resize-none rounded-xl border border-[#2a1808] bg-black/35 px-3 py-2 text-sm text-[#e8d5a3] outline-none focus:border-[#c9a040]" />
            <button onClick={onSave} className="w-full rounded-xl bg-[#f5c842] px-4 py-3 font-cinzel text-[0.7rem] font-bold uppercase tracking-widest text-black">Save Profile</button>
            {status && (
              <p className={`rounded-xl border p-3 text-sm leading-6 ${status.type === 'ok' ? 'border-[#285028] bg-[#286428]/10 text-[#70c070]' : status.type === 'err' ? 'border-[#502020] bg-[#641e1e]/10 text-[#dd7070]' : 'border-[#3a2808] bg-[#3c1e05]/10 text-[#a08040]'}`}>{status.msg}</p>
            )}
          </div>
        </aside>

        <section className="rounded-[28px] border border-[#3a2808] bg-[#100904]/88 p-5 shadow-[0_24px_90px_rgba(0,0,0,0.42)]">
          <div className="mb-5 flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
            <div>
              <h2 className="font-cinzel-decorative text-2xl tracking-widest text-[#f5c842]">Wishing Well History</h2>
              <p className="mt-2 text-sm leading-6 text-[#9c793c]">Everything inscribed through this site with the connected wallet, including the visible ordinal inscription ID.</p>
            </div>
            <div className="relative min-w-[240px]">
              <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#5a4018]" size={15} />
              <input value={search} onChange={(e) => onSearch(e.target.value)} placeholder="Search inscriptions" className="w-full rounded-xl border border-[#2a1808] bg-black/35 py-2 pl-9 pr-3 text-sm text-[#e8d5a3] outline-none focus:border-[#c9a040]" />
            </div>
          </div>

          {!filtered.length ? (
            <div className="rounded-2xl border border-dashed border-[#2a1a08] bg-black/20 p-10 text-center">
              <Coins className="mx-auto mb-3 text-[#4a3018]" size={42} />
              <p className="mb-5 text-sm text-[#7a5a25]">No Wishing Well inscriptions found for this wallet yet.</p>
              <button onClick={onCast} className="font-cinzel text-[0.7rem] uppercase tracking-widest text-[#c9a040] hover:text-[#f5c842]">Inscribe something</button>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {filtered.map((ins) => (
                <React.Fragment key={ins.wishTxid}>
                  <InscriptionCard ins={ins} profile={profiles[ins.address]} />
                </React.Fragment>
              ))}
            </div>
          )}
        </section>
      </section>
    </main>
  );
}

function Pill({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-[#3a2808] bg-black/30 px-3 py-1 font-cinzel text-[0.58rem] uppercase tracking-widest text-[#c9a040]">
      {icon} {label}
    </span>
  );
}

function ProfileSummary({ wallet, profile, draft, total, confirmed, pending, balance, onConnect, onRefresh, onDraft, onSave }: {
  wallet: { type: WalletType; ordAddr: string; payAddr: string; balance: number } | null;
  profile?: Profile;
  draft: { displayName: string; avatarUrl: string; twitterUrl: string; bio: string };
  total: number;
  confirmed: number;
  pending: number;
  balance: number;
  onConnect: () => void;
  onRefresh: () => void;
  onDraft: (next: { displayName: string; avatarUrl: string; twitterUrl: string; bio: string }) => void;
  onSave: () => void;
}) {
  return (
    <div className="rounded-2xl border border-[#3a2808] bg-[#100904]/88 p-5">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-cinzel text-[0.78rem] font-bold uppercase tracking-widest text-[#f5c842]">Profile</h2>
        {wallet && <button onClick={onRefresh} className="rounded-lg border border-[#3a2808] p-2 text-[#7a5a25] transition hover:text-[#f5c842]" aria-label="Refresh balance"><RefreshCw size={14} /></button>}
      </div>

      {wallet ? (
        <>
          <div className="rounded-xl border border-[#2a1808] bg-black/30 p-3">
            <div className="font-cinzel text-[0.58rem] uppercase tracking-widest text-[#6f501f]">Ordinal wallet museum card</div>
            <div className="mt-1 break-all font-mono text-[0.74rem] text-[#c9a040]">{wallet.ordAddr}</div>
            {profile?.twitterUrl && (
              <a href={profile.twitterUrl} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex items-center gap-1 text-[0.72rem] text-[#f5c842] hover:underline">
                <AtSign size={13} /> Linked Twitter
              </a>
            )}
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <MiniStat label="Balance" value={`${balance.toLocaleString()} sats`} />
            <MiniStat label="History" value={total.toString()} />
            <MiniStat label="Confirmed" value={confirmed.toString()} />
            <MiniStat label="Pending" value={pending.toString()} />
          </div>
          <div className="mt-3 space-y-2 rounded-xl border border-[#2a1808] bg-black/25 p-3">
            <input
              value={draft.displayName}
              onChange={(e) => onDraft({ ...draft, displayName: e.target.value })}
              placeholder="Display name"
              className="w-full rounded-lg border border-[#2a1808] bg-black/35 px-3 py-2 text-sm text-[#e8d5a3] outline-none focus:border-[#c9a040]"
            />
            <input
              value={draft.avatarUrl}
              onChange={(e) => onDraft({ ...draft, avatarUrl: e.target.value })}
              placeholder="Profile picture URL"
              className="w-full rounded-lg border border-[#2a1808] bg-black/35 px-3 py-2 text-sm text-[#e8d5a3] outline-none focus:border-[#c9a040]"
            />
            <input
              value={draft.twitterUrl}
              onChange={(e) => onDraft({ ...draft, twitterUrl: e.target.value })}
              placeholder="https://x.com/username"
              className="w-full rounded-lg border border-[#2a1808] bg-black/35 px-3 py-2 text-sm text-[#e8d5a3] outline-none focus:border-[#c9a040]"
            />
            <textarea
              value={draft.bio}
              onChange={(e) => onDraft({ ...draft, bio: e.target.value })}
              placeholder="Short museum bio"
              className="h-20 w-full resize-none rounded-lg border border-[#2a1808] bg-black/35 px-3 py-2 text-sm text-[#e8d5a3] outline-none focus:border-[#c9a040]"
            />
            <button onClick={onSave} className="w-full rounded-lg bg-[#f5c842] px-3 py-2 font-cinzel text-[0.65rem] font-bold uppercase tracking-widest text-black">
              Save Twitter Link
            </button>
          </div>
        </>
      ) : (
        <div className="rounded-xl border border-dashed border-[#3a2808] bg-black/25 p-5 text-center">
          <User className="mx-auto mb-3 text-[#6f501f]" size={28} />
          <p className="text-sm leading-6 text-[#9c793c]">Connect a Bitcoin wallet to save and view your inscription history.</p>
          <button onClick={onConnect} className="mt-4 rounded-xl bg-[#f5c842] px-4 py-2 font-cinzel text-[0.68rem] font-bold uppercase tracking-widest text-black">
            Connect Wallet
          </button>
        </div>
      )}
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-[#2a1808] bg-black/25 p-3">
      <div className="font-cinzel text-[0.53rem] uppercase tracking-widest text-[#6f501f]">{label}</div>
      <div className="mt-1 font-mono text-[0.83rem] text-[#e8d5a3]">{value}</div>
    </div>
  );
}

function SafetyPanel() {
  return (
    <div className="rounded-2xl border border-[#3a2808] bg-[#100904]/88 p-5">
      <h2 className="mb-3 flex items-center gap-2 font-cinzel text-[0.78rem] font-bold uppercase tracking-widest text-[#f5c842]">
        <ShieldCheck size={16} /> Safe Inscribing
      </h2>
      <ul className="space-y-3 text-sm leading-6 text-[#9c793c]">
        <li>Connecting only shares public wallet addresses and reads balance. It does not spend, sign, or inscribe.</li>
        <li>Review the wallet prompt before signing. Bitcoin inscriptions are permanent.</li>
        <li>Use this for code, images, songs, and art that you want preserved on Bitcoin.</li>
        <li>Never enter a seed phrase or private key. This site will never ask for one.</li>
      </ul>
    </div>
  );
}

function InscribePanel(props: {
  selFile: File | null;
  wishText: string;
  feeRates: FeeRates;
  selRate: FeeTier;
  customRate: number;
  wallet: { type: WalletType; ordAddr: string; payAddr: string; balance: number } | null;
  status: { type: 'ok' | 'err' | 'info'; msg: string } | null;
  progress: { p: number; l: string } | null;
  contentBytes: number;
  netFee: number;
  totalFee: number;
  canInscribe: boolean;
  maxFileSizeLabel: string;
  onFile: (file: File) => void;
  onRemoveFile: () => void;
  onWishText: (value: string) => void;
  onSelRate: (value: FeeTier) => void;
  onCustomRate: (value: number) => void;
  onConnect: () => void;
  onDisconnect: () => void;
  onInscribe: () => void;
}) {
  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_290px]">
      <div>
        <div className="mb-5">
          <h2 className="font-cinzel-decorative text-2xl tracking-widest text-[#f5c842]">Inscribe</h2>
          <p className="mt-2 text-sm leading-6 text-[#9c793c]">Inscribe code, images, songs, writing, and art directly to Bitcoin.</p>
        </div>

        {!props.selFile ? (
          <label className="relative mb-4 block cursor-pointer rounded-2xl border border-dashed border-[#4a3015] bg-[#f5c842]/[0.025] p-6 text-center transition hover:border-[#f5c842]/70 hover:bg-[#f5c842]/[0.055]">
            <input type="file" onChange={(e) => e.target.files?.[0] && props.onFile(e.target.files[0])} className="absolute inset-0 cursor-pointer opacity-0" />
            <Upload className="mx-auto mb-3 text-[#c9a040]" size={30} />
            <div className="font-cinzel text-[0.78rem] font-bold uppercase tracking-widest text-[#d8b55b]">Upload content</div>
            <p className="mt-2 text-sm leading-6 text-[#7a5a25]">PNG, JPG, GIF, WEBP, MP3, WAV, HTML, CSS, JS, JSON, TXT, MD. Max {props.maxFileSizeLabel}.</p>
          </label>
        ) : (
          <div className="mb-4 flex items-center gap-3 rounded-2xl border border-[#3a2808] bg-black/25 p-4">
            <div className="grid h-12 w-12 place-items-center rounded-xl border border-[#3a2808] bg-[#1a1208] text-[#c9a040]">
              {props.selFile.type.startsWith('image/') ? <ImageIcon size={22} /> : <FileText size={22} />}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-[#d4a040]">{props.selFile.name}</p>
              <p className="text-xs text-[#6a4a1a]">{(props.selFile.size / 1024).toFixed(1)} KB</p>
            </div>
            <button onClick={props.onRemoveFile} className="rounded-lg p-2 text-[#6a4a1a] transition hover:text-[#e06030]" aria-label="Remove selected file">
              <X size={18} />
            </button>
          </div>
        )}

        <label className="mb-4 block">
          <span className="mb-2 block font-cinzel text-[0.7rem] uppercase tracking-widest text-[#7a5a25]">Inscription text</span>
          <textarea value={props.wishText} onChange={(e) => props.onWishText(e.target.value)} className="h-32 w-full resize-none rounded-2xl border border-[#2a1808] bg-black/35 p-4 text-[#e8d5a3] outline-none transition placeholder:text-[#4a3018] focus:border-[#c9a040]" placeholder="Write what you want sealed on Bitcoin..." />
        </label>

        <div className="mb-4">
          <span className="mb-2 block font-cinzel text-[0.7rem] uppercase tracking-widest text-[#7a5a25]">Fee speed</span>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {(['slow', 'med', 'fast', 'custom'] as FeeTier[]).map((tier) => (
              <button key={tier} onClick={() => props.onSelRate(tier)} className={`rounded-xl border p-3 text-left transition ${props.selRate === tier ? 'border-[#c9a040] bg-[#f5c842]/10' : 'border-[#2a1808] bg-black/25 hover:border-[#5a3a18]'}`}>
                <span className={`block font-cinzel text-[0.63rem] font-bold uppercase tracking-widest ${props.selRate === tier ? 'text-[#f5c842]' : 'text-[#7a5a25]'}`}>{tier}</span>
                <span className="mt-1 block font-mono text-sm text-[#c9a040]">{tier === 'custom' ? props.customRate : props.feeRates[tier]} s/vB</span>
              </button>
            ))}
          </div>
          {props.selRate === 'custom' && (
            <div className="mt-3 flex items-center gap-3 rounded-xl border border-[#2a1808] bg-black/35 p-3">
              <span className="font-cinzel text-[0.65rem] uppercase tracking-widest text-[#7a5a25]">Sats/vB</span>
              <input type="number" value={props.customRate} onChange={(e) => props.onCustomRate(Math.max(1, parseInt(e.target.value) || 1))} className="min-w-0 flex-1 bg-transparent font-mono text-[#f5c842] outline-none" />
            </div>
          )}
        </div>

        <div className="mb-4 rounded-2xl border border-[#342208] bg-[#f5c842]/[0.035] p-4">
          <span className="block font-cinzel text-[0.78rem] text-[#c9a040]">Service fee <span className="ml-1 rounded border border-[#f5c842]/25 bg-[#f5c842]/10 px-1.5 text-[0.6rem] text-[#f5c842]">+{SERVICE_FEE.toLocaleString()} sats</span></span>
          <span className="mt-1 block text-sm leading-6 text-[#7a5a25]">Supports hosting the public inscription museum, profile history, and social features.</span>
        </div>

        {props.status && (
          <div className={`mb-4 rounded-xl border p-3 text-sm leading-6 ${props.status.type === 'ok' ? 'border-[#285028] bg-[#286428]/10 text-[#70c070]' : props.status.type === 'err' ? 'border-[#502020] bg-[#641e1e]/10 text-[#dd7070]' : 'border-[#3a2808] bg-[#3c1e05]/10 text-[#a08040]'}`}>
            {props.status.msg}
          </div>
        )}
      </div>

      <aside className="rounded-2xl border border-[#2a1808] bg-black/25 p-4">
        <h3 className="mb-4 font-cinzel text-[0.72rem] font-bold uppercase tracking-widest text-[#f5c842]">Review</h3>
        <div className="space-y-3 text-sm">
          <ReviewLine label="Content size" value={`${props.contentBytes.toLocaleString()} B`} />
          <ReviewLine label="Network fee" value={`${props.netFee.toLocaleString()} sats`} />
          <ReviewLine label="Service fee" value={`${SERVICE_FEE.toLocaleString()} sats`} />
          <div className="border-t border-[#2a1808] pt-3">
            <ReviewLine label="Estimated total" value={`${props.totalFee.toLocaleString()} sats`} strong />
          </div>
        </div>

        <div className="mt-5 rounded-xl border border-[#2a1808] bg-black/25 p-3">
          {props.wallet ? (
            <div>
              <div className="font-cinzel text-[0.58rem] uppercase tracking-widest text-[#6f501f]">Wallet</div>
              <div className="mt-1 font-mono text-xs text-[#c9a040]">{props.wallet.ordAddr.slice(0, 8)}...{props.wallet.ordAddr.slice(-8)}</div>
              <div className={`mt-2 font-mono text-sm ${props.wallet.balance >= props.totalFee ? 'text-[#70c070]' : 'text-[#dd7070]'}`}>{props.wallet.balance.toLocaleString()} sats</div>
              <button onClick={props.onDisconnect} className="mt-2 font-cinzel text-[0.58rem] uppercase tracking-widest text-[#6a3a18] underline">Disconnect</button>
            </div>
          ) : (
            <button onClick={props.onConnect} className="w-full rounded-xl border border-[#f5c842]/30 bg-[#f5c842]/10 px-4 py-3 font-cinzel text-[0.68rem] font-bold uppercase tracking-widest text-[#f5c842]">
              Connect Wallet
            </button>
          )}
        </div>

        <button onClick={props.onInscribe} disabled={!props.canInscribe} className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-br from-[#f5c842] to-[#b88418] px-5 py-4 font-cinzel text-[0.8rem] font-bold uppercase tracking-[0.16em] text-black transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-35">
          <Coins size={18} /> Inscribe Now
        </button>

        {props.progress && (
          <div className="mt-4">
            <div className="h-1.5 overflow-hidden rounded-full bg-[#1a1008]">
              <div className="h-full bg-gradient-to-r from-[#c9a040] to-[#f5c842] transition-all duration-500" style={{ width: `${props.progress.p}%` }} />
            </div>
            <p className="mt-2 text-center font-cinzel text-[0.62rem] uppercase tracking-widest text-[#7a5a25]">{props.progress.l}</p>
          </div>
        )}
      </aside>
    </div>
  );
}

function ReviewLine({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="font-cinzel text-[0.62rem] uppercase tracking-widest text-[#6f501f]">{label}</span>
      <span className={`font-mono ${strong ? 'text-base font-bold text-[#f5c842]' : 'text-[#c9a040]'}`}>{value}</span>
    </div>
  );
}

function HistoryPanel({ wallet, search, inscriptions, total, profiles, onSearch, onCast, onConnect }: {
  wallet: { type: WalletType; ordAddr: string; payAddr: string; balance: number } | null;
  search: string;
  inscriptions: Inscription[];
  total: number;
  profiles: Record<string, Profile>;
  onSearch: (value: string) => void;
  onCast: () => void;
  onConnect: () => void;
}) {
  if (!wallet) {
    return (
      <div className="rounded-2xl border border-dashed border-[#3a2808] bg-black/25 p-10 text-center">
        <History className="mx-auto mb-4 text-[#6f501f]" size={42} />
        <h2 className="font-cinzel-decorative text-2xl tracking-widest text-[#f5c842]">Profile History</h2>
        <p className="mx-auto mt-3 max-w-md text-sm leading-7 text-[#9c793c]">Connect your wallet to see every inscription ID indexed to that ordinal address.</p>
        <button onClick={onConnect} className="mt-5 rounded-xl bg-[#f5c842] px-5 py-3 font-cinzel text-[0.7rem] font-bold uppercase tracking-widest text-black">Connect Wallet</button>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-5 flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
        <div>
          <h2 className="font-cinzel-decorative text-2xl tracking-widest text-[#f5c842]">Profile History</h2>
          <p className="mt-2 text-sm text-[#7a5a25]">{total} indexed inscription{total === 1 ? '' : 's'} found for this wallet.</p>
        </div>
        <div className="relative min-w-[220px]">
          <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#5a4018]" size={15} />
          <input value={search} onChange={(e) => onSearch(e.target.value)} placeholder="Search history" className="w-full rounded-xl border border-[#2a1808] bg-black/35 py-2 pl-9 pr-3 text-sm text-[#e8d5a3] outline-none focus:border-[#c9a040]" />
        </div>
      </div>

      {!inscriptions.length ? (
        <div className="rounded-2xl border border-dashed border-[#2a1a08] bg-black/20 p-10 text-center">
          <Coins className="mx-auto mb-3 text-[#4a3018]" size={42} />
          <p className="mb-5 text-sm text-[#7a5a25]">{search ? 'No inscriptions match your search.' : 'No inscriptions found for this wallet yet.'}</p>
          <button onClick={onCast} className="font-cinzel text-[0.7rem] uppercase tracking-widest text-[#c9a040] hover:text-[#f5c842]">Create an inscription</button>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {inscriptions.map((ins) => (
            <React.Fragment key={ins.wishTxid}>
              <InscriptionCard ins={ins} profile={profiles[ins.address]} />
            </React.Fragment>
          ))}
        </div>
      )}
    </div>
  );
}

function MuseumGallery({ inscriptions, profiles }: { inscriptions: Inscription[]; profiles: Record<string, Profile> }) {
  return (
    <section className="rounded-2xl border border-[#3a2808] bg-[#100904]/88 p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h2 className="font-cinzel text-[0.78rem] font-bold uppercase tracking-widest text-[#f5c842]">On-Chain Museum</h2>
          <p className="mt-1 text-sm text-[#7a5a25]">All inscriptions created on this website, indexed by profile with visible inscription IDs.</p>
        </div>
        <Clock size={16} className="shrink-0 text-[#7a5a25]" />
      </div>
      {!inscriptions.length ? (
        <p className="rounded-xl border border-dashed border-[#2a1808] bg-black/25 p-5 text-center text-sm text-[#7a5a25]">Inscriptions created here will appear in the museum.</p>
      ) : (
        <div className="max-h-[820px] space-y-3 overflow-y-auto pr-1">
          {inscriptions.map((ins) => (
            <div key={ins.wishTxid} className="flex items-center gap-3 rounded-xl border border-[#2a1808] bg-black/25 p-3">
              <PreviewThumb ins={ins} compact />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-[#d4a040]">{ins.wish}</p>
                <p className="mt-1 truncate text-[0.7rem] text-[#7a5a25]">{profiles[ins.address]?.displayName || `${ins.address.slice(0, 6)}...${ins.address.slice(-4)}`}</p>
                <p className="mt-2 font-cinzel text-[0.55rem] uppercase tracking-widest text-[#6f501f]">Inscription ID</p>
                <p className="mt-1 break-all font-mono text-[0.65rem] text-[#c9a040]">{inscriptionId(ins)}</p>
              </div>
              <div className="flex flex-col gap-2">
                <a href={ordinalsContentUrl(ins)} target="_blank" rel="noopener noreferrer" className="text-[#7a5a25] transition hover:text-[#f5c842]" aria-label="View on-chain content">
                  <ImageIcon size={14} />
                </a>
                <a href={ordIoUrl(ins)} target="_blank" rel="noopener noreferrer" className="text-[#7a5a25] transition hover:text-[#f5c842]" aria-label="View on Ord.io">
                  <ExternalLink size={14} />
                </a>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function HowItWorks() {
  const steps = [
    ['Connect your Bitcoin wallet', 'Use Xverse for live inscription support, then confirm you are on Bitcoin Mainnet.'],
    ['Choose what to preserve', 'Upload code, images, songs, HTML, JSON, writing, or art. Smaller files cost less.'],
    ['Pick fee speed', 'Slow is cheaper. Fast is usually quicker. Custom is for advanced users watching mempool fees.'],
    ['Review and sign', 'Check network fee, service fee, content type, and wallet prompt before signing.'],
    ['Visit your museum', 'After submission, your profile history and the public museum show the on-chain inscription ID and link.'],
  ];

  return (
    <section className="rounded-2xl border border-[#3a2808] bg-[#100904]/88 p-5">
      <h2 className="mb-4 font-cinzel text-[0.78rem] font-bold uppercase tracking-widest text-[#f5c842]">How To Inscribe</h2>
      <div className="grid gap-3">
        {steps.map(([title, body], index) => (
          <div key={title} className="flex gap-3 rounded-xl border border-[#2a1808] bg-black/25 p-3">
            <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[#f5c842] font-mono text-sm font-bold text-black">{index + 1}</div>
            <div>
              <div className="font-cinzel text-[0.68rem] uppercase tracking-widest text-[#c9a040]">{title}</div>
              <p className="mt-1 text-sm leading-6 text-[#7a5a25]">{body}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function MuseumChat({ wallet, profiles, messages, text, onText, onSend, onConnect }: {
  wallet: { type: WalletType; ordAddr: string; payAddr: string; balance: number } | null;
  profiles: Record<string, Profile>;
  messages: ChatMessage[];
  text: string;
  onText: (value: string) => void;
  onSend: () => void;
  onConnect: () => void;
}) {
  return (
    <section className="rounded-2xl border border-[#3a2808] bg-[#100904]/88 p-5">
      <h2 className="mb-2 flex items-center gap-2 font-cinzel text-[0.78rem] font-bold uppercase tracking-widest text-[#f5c842]">
        <MessageCircle size={16} /> Museum Chat
      </h2>
      <p className="mb-4 text-sm leading-6 text-[#7a5a25]">Talk with other ordinal wallet profiles. Messages are attached to wallet addresses.</p>

      <div className="mb-4 max-h-[320px] space-y-3 overflow-y-auto rounded-xl border border-[#2a1808] bg-black/25 p-3">
        {!messages.length ? (
          <p className="py-8 text-center text-sm text-[#5f4218]">No messages yet. Start the museum wall.</p>
        ) : (
          messages.map((msg) => {
            const profile = profiles[msg.address];
            return (
              <div key={msg.id} className="rounded-lg border border-[#2a1808] bg-[#120a04] p-3">
                <div className="mb-1 flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-semibold text-[#d4a040]">{profile?.displayName || `${msg.address.slice(0, 6)}...${msg.address.slice(-4)}`}</span>
                  {profile?.twitterUrl && (
                    <a href={profile.twitterUrl} target="_blank" rel="noopener noreferrer" className="shrink-0 text-[#f5c842]" aria-label="Twitter profile">
                      <AtSign size={13} />
                    </a>
                  )}
                </div>
                <p className="text-sm leading-6 text-[#9c793c]">{msg.text}</p>
              </div>
            );
          })
        )}
      </div>

      {wallet ? (
        <div className="flex gap-2">
          <input
            value={text}
            onChange={(e) => onText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onSend();
            }}
            placeholder="Leave a museum message..."
            maxLength={280}
            className="min-w-0 flex-1 rounded-xl border border-[#2a1808] bg-black/35 px-3 py-2 text-sm text-[#e8d5a3] outline-none focus:border-[#c9a040]"
          />
          <button onClick={onSend} className="rounded-xl bg-[#f5c842] px-3 text-black transition hover:brightness-110" aria-label="Send message">
            <Send size={16} />
          </button>
        </div>
      ) : (
        <button onClick={onConnect} className="w-full rounded-xl border border-[#f5c842]/30 bg-[#f5c842]/10 px-4 py-3 font-cinzel text-[0.68rem] font-bold uppercase tracking-widest text-[#f5c842]">
          Connect to chat
        </button>
      )}
    </section>
  );
}

function InscriptionCard({ ins, profile }: { ins: Inscription; profile?: Profile }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-[#2a1a08] bg-gradient-to-br from-[#130e06] to-[#0d0804] transition hover:border-[#5a3a18]">
      <div className="relative aspect-square bg-black/40">
        <PreviewThumb ins={ins} />
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent" />
        <div className="absolute right-2 top-2">
          <StatusBadge status={ins.status} />
        </div>
      </div>
      <div className="p-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <span className="truncate font-cinzel text-[0.54rem] uppercase tracking-widest text-[#7a5a25]">{(ins.contentType.split('/')[1] || ins.contentType).toUpperCase()}</span>
          {ins.serviceFee && <span className="inline-flex items-center gap-1 text-[0.54rem] uppercase tracking-widest text-[#70c070]"><ShieldCheck size={9} /> Site</span>}
        </div>
        <div className="mb-2 flex items-center gap-2 text-[0.68rem] text-[#7a5a25]">
          <User size={12} />
          <span className="truncate">{profile?.displayName || `${ins.address.slice(0, 6)}...${ins.address.slice(-4)}`}</span>
          {profile?.twitterUrl && <AtSign size={12} className="text-[#f5c842]" />}
        </div>
        <p className="line-clamp-2 min-h-[40px] text-sm italic leading-5 text-[#d4a040]">"{ins.wish}"</p>
        <div className="mt-3 rounded-xl border border-[#2a1a08] bg-black/25 p-2">
          <div className="font-cinzel text-[0.52rem] uppercase tracking-widest text-[#6f501f]">Inscription ID</div>
          <div className="mt-1 break-all font-mono text-[0.66rem] leading-4 text-[#c9a040]">{inscriptionId(ins)}</div>
        </div>
        <div className="mt-3 flex items-center justify-between gap-2 border-t border-[#2a1a08] pt-3">
          <a href={ordinalsContentUrl(ins)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-cinzel text-[0.58rem] uppercase tracking-widest text-[#c9a040] transition hover:text-[#f5c842]">
            Content <ExternalLink size={9} />
          </a>
          <a href={ordIoUrl(ins)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-cinzel text-[0.58rem] uppercase tracking-widest text-[#c9a040] transition hover:text-[#f5c842]">
            Ord.io <ExternalLink size={9} />
          </a>
        </div>
      </div>
    </div>
  );
}

function PreviewThumb({ ins, compact }: { ins: Inscription; compact?: boolean }) {
  const size = compact ? 'h-12 w-12 rounded-lg' : 'h-full w-full';
  if (ins.contentType.startsWith('image/')) {
    return (
      <img
        src={ordinalsContentUrl(ins)}
        alt="Inscription content"
        className={`${size} object-cover`}
        referrerPolicy="no-referrer"
        onError={(e) => {
          (e.currentTarget as HTMLImageElement).style.display = 'none';
        }}
      />
    );
  }

  if (ins.contentType.startsWith('audio/')) {
    return (
      <div className={`${size} grid place-items-center bg-[#120a04] p-3 text-center`}>
        <Music className="mb-1 text-[#c9a040]" size={compact ? 18 : 38} />
        {!compact && <p className="text-sm italic leading-6 text-[#d4a040]">On-chain audio inscription</p>}
      </div>
    );
  }

  return (
    <div className={`${size} grid place-items-center bg-[#120a04] p-3 text-center`}>
      <FileText className="mb-1 text-[#7a5a25]" size={compact ? 18 : 34} />
      {!compact && <p className="line-clamp-5 text-sm italic leading-6 text-[#d4a040]">"{ins.wish}"</p>}
    </div>
  );
}

function StatusBadge({ status }: { status?: 'pending' | 'confirmed' | 'failed' }) {
  if (status === 'confirmed') {
    return <span className="rounded-full bg-[#55d070] px-2 py-1 text-[0.55rem] font-bold uppercase text-black">Confirmed</span>;
  }
  if (status === 'failed') {
    return <span className="rounded-full bg-[#cc5050] px-2 py-1 text-[0.55rem] font-bold uppercase text-white">Failed</span>;
  }
  return <span className="rounded-full bg-[#f5c842] px-2 py-1 text-[0.55rem] font-bold uppercase text-black">Pending</span>;
}

function SuccessModal({ lastTxid, onClose }: { lastTxid: string; onClose: () => void }) {
  const visibleInscriptionId = lastTxid.includes('i') ? lastTxid : `${lastTxid}i0`;

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/90 p-6 backdrop-blur-md">
      <motion.div initial={{ scale: 0.88, y: 20, opacity: 0 }} animate={{ scale: 1, y: 0, opacity: 1 }} exit={{ scale: 0.88, y: 20, opacity: 0 }} className="w-full max-w-md overflow-hidden rounded-3xl border border-[#f5c842]/40 bg-[#1a120a] p-8 text-center shadow-[0_0_100px_rgba(245,200,66,0.2)]">
        <div className="mx-auto mb-6 grid h-20 w-20 place-items-center rounded-full bg-gradient-to-br from-[#c9a040] to-[#f5c842] shadow-[0_0_30px_rgba(201,160,64,0.4)]">
          <Check size={40} className="text-black" strokeWidth={3} />
        </div>
        <h2 className="font-cinzel-decorative text-2xl uppercase tracking-widest text-[#f5c842]">Inscription Sent</h2>
        <p className="mt-3 text-sm leading-7 text-[#9c793c]">Your inscription was submitted and is indexing on your profile and the public museum.</p>
        <div className="my-6 rounded-2xl border border-[#3a2808] bg-black/40 p-4">
          <div className="mb-4 text-left">
            <p className="font-cinzel text-[0.58rem] uppercase tracking-widest text-[#6f501f]">Inscription ID</p>
            <p className="mt-2 break-all font-mono text-xs leading-5 text-[#f5c842]">{visibleInscriptionId}</p>
          </div>
          <div className="flex items-center justify-center gap-4">
          <a href={`https://mempool.space/tx/${lastTxid}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-cinzel text-[0.65rem] uppercase tracking-widest text-[#c9a040] hover:text-[#f5c842]">View Tx <ExternalLink size={10} /></a>
          <a href={`https://ord.io/${visibleInscriptionId}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-cinzel text-[0.65rem] uppercase tracking-widest text-[#c9a040] hover:text-[#f5c842]">View Ord <ExternalLink size={10} /></a>
          </div>
        </div>
        <button onClick={onClose} className="w-full rounded-xl bg-gradient-to-r from-[#c9a040] to-[#f5c842] py-4 font-cinzel text-[0.8rem] font-bold uppercase tracking-[0.2em] text-black">
          Back to App
        </button>
      </motion.div>
    </motion.div>
  );
}

function WalletModal({ onClose, onXverse, onUnisat }: { onClose: () => void; onXverse: () => void; onUnisat: () => void }) {
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/80 px-4 backdrop-blur-sm">
      <motion.div initial={{ scale: 0.92, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.92, y: 20 }} className="w-full max-w-sm rounded-2xl border border-[#f5c842]/30 bg-[#1a120a] p-6 shadow-[0_0_50px_rgba(0,0,0,0.5)]">
        <div className="mb-6 flex items-center justify-between">
          <h3 className="font-cinzel text-sm uppercase tracking-widest text-[#f5c842]">Connect Wallet</h3>
          <button onClick={onClose} className="text-[#7a5a25] transition hover:text-[#f5c842]"><X size={20} /></button>
        </div>
        <div className="mb-5 rounded-xl border border-[#2a1808] bg-black/30 p-4">
          <h4 className="mb-2 flex items-center gap-2 font-cinzel text-[0.68rem] font-bold uppercase tracking-widest text-[#c9a040]">
            <ShieldCheck size={14} /> Safe Connect
          </h4>
          <ul className="space-y-2 text-sm leading-6 text-[#9c793c]">
            <li>Connect only shares public Bitcoin addresses.</li>
            <li>No transaction, inscription, or service fee happens here.</li>
            <li>Never enter a seed phrase or private key.</li>
          </ul>
        </div>
        <div className="space-y-3">
          <button onClick={onXverse} className="flex w-full items-center justify-between rounded-xl border border-[#3a2808] bg-gradient-to-br from-[#1c1208] to-[#130d05] p-4 font-cinzel text-[0.8rem] font-bold uppercase tracking-wider text-[#b09040] transition hover:border-[#c9a040] hover:text-[#f5c842]">
            <span>Xverse</span>
            <span className="text-xs text-[#6f501f]">Recommended</span>
          </button>
          <button onClick={onUnisat} className="flex w-full items-center justify-between rounded-xl border border-[#3a2808] bg-gradient-to-br from-[#1c1208] to-[#130d05] p-4 font-cinzel text-[0.8rem] font-bold uppercase tracking-wider text-[#b09040] transition hover:border-[#c9a040] hover:text-[#f5c842]">
            <span>UniSat</span>
            <span className="text-xs text-[#6f501f]">Connect only</span>
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

function ConfirmModal(props: {
  selFile: File | null;
  wishText: string;
  selRate: FeeTier;
  currentRate: number;
  netFee: number;
  totalFee: number;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/80 px-4 backdrop-blur-sm">
      <motion.div initial={{ scale: 0.92, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.92, y: 20 }} className="w-full max-w-md rounded-2xl border border-[#f5c842]/30 bg-[#1a120a] p-6 shadow-[0_0_50px_rgba(0,0,0,0.5)]">
        <h3 className="mb-6 flex items-center justify-center gap-2 text-center font-cinzel uppercase tracking-widest text-[#f5c842]">
          <AlertTriangle size={18} /> Confirm Inscription
        </h3>
        <p className="mb-5 rounded-xl border border-[#3a2808] bg-black/30 p-3 text-sm leading-6 text-[#9c793c]">
          This is the only step that asks your wallet to create an inscription and pay the service fee. Check the wallet prompt before approving.
        </p>
        <div className="mb-8 space-y-4 text-sm">
          <ReviewLine label="Content" value={props.selFile ? `File: ${props.selFile.name}` : props.wishText ? 'Text inscription' : 'Empty'} />
          <ReviewLine label="Fee rate" value={`${props.currentRate} sats/vB`} />
          <ReviewLine label="Network fee" value={`${props.netFee.toLocaleString()} sats`} />
          <ReviewLine label="Service fee" value={`${SERVICE_FEE.toLocaleString()} sats`} />
          <div className="border-t border-[#3a2808] pt-3">
            <ReviewLine label="Total due" value={`${props.totalFee.toLocaleString()} sats`} strong />
          </div>
        </div>
        <div className="flex gap-3">
          <button onClick={props.onCancel} className="flex-1 rounded-xl border border-[#3a2808] py-3 font-cinzel text-[0.7rem] uppercase tracking-widest text-[#7a5a25] transition hover:bg-white/5">Cancel</button>
          <button onClick={props.onConfirm} className="flex-1 rounded-xl bg-gradient-to-br from-[#f5c842] to-[#c9a040] py-3 font-cinzel text-[0.7rem] font-bold uppercase tracking-widest text-black transition hover:brightness-110">Confirm</button>
        </div>
      </motion.div>
    </motion.div>
  );
}
