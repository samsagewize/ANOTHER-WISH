import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ChatMessage, FeeRates, FeeTier, Inscription, Profile, WalletType } from './types';
import { DEV_ADDR, SERVICE_FEE, fetchBalance, fetchFeeRates, fetchTxStatus, loadSatsConnect, toB64 } from './services/bitcoinService';
import { OperationType, auth, collection, db, doc, handleFirestoreError, limit, onSnapshot, orderBy, query, setDoc, updateDoc } from './firebase';
import { onAuthStateChanged, signInAnonymously } from 'firebase/auth';

const MAX_FILE_SIZE = 500 * 1024;
const MAX_FILE_SIZE_LABEL = '500KB';
const MUSEUM_RESET_AT = 1779425915000;

const field = 'w-full border-b border-rule bg-transparent py-3 text-base text-ink outline-none placeholder:text-muted focus:border-ink';
const label = 'mb-2 block text-xs text-muted';
const primary = 'inline-flex h-11 items-center justify-center bg-brand px-5 text-sm font-medium text-white hover:bg-[#7f2a0f] disabled:cursor-not-allowed disabled:bg-rule disabled:text-muted';
const textBtn = 'text-sm text-muted hover:text-ink';

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
  const [homeSection, setHomeSection] = useState<'inscribe' | 'museum' | 'chat'>('inscribe');
  const [page, setPage] = useState<'welcome' | 'home' | 'profile' | 'brc' | 'about'>(() => {
    if (window.location.pathname === '/welcome') return 'welcome';
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
      if (window.location.pathname === '/welcome') setPage('welcome');
      else if (window.location.pathname === '/profile') setPage('profile');
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
    window.history.pushState({}, '', '/welcome');
    setPage('welcome');
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
    setHomeSection('inscribe');
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
        message: 'BTC Inscriber - connect to inscribe on mainnet',
        network: 'Mainnet',
      });

      if (resp.status === 'success') {
        const addrs = resp.result.addresses;
        const ord = addrs.find((a: any) => a.purpose === AddressPurpose.Ordinals) || addrs[0];
        const pay = addrs.find((a: any) => a.purpose === AddressPurpose.Payment) || ord;
        const bal = await fetchBalance(pay.address);
        setWallet({ type: 'xverse', ordAddr: ord.address, payAddr: pay.address, balance: bal });
        setStatus({ type: 'ok', msg: 'Connected. Nothing was signed.' });
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
      setStatus({ type: 'ok', msg: 'UniSat connected. Use Xverse to inscribe.' });
    } catch (err: any) {
      setStatus({ type: 'err', msg: 'UniSat connect failed: ' + err.message });
    }
  };

  const handleFile = (file: File) => {
    if (file.size > MAX_FILE_SIZE) {
      setStatus({ type: 'err', msg: `File must be under ${MAX_FILE_SIZE_LABEL}.` });
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
      setStatus({ type: 'err', msg: 'Use a link like https://x.com/username.' });
      return;
    }

    const avatarUrl = profileDraft.avatarUrl.trim();
    if (avatarUrl && !/^https:\/\/.+/i.test(avatarUrl)) {
      setStatus({ type: 'err', msg: 'Profile picture must be an https:// URL.' });
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
    setStatus({ type: 'ok', msg: 'Profile saved.' });
  };

  const sendMessage = async () => {
    if (!wallet) {
      setShowWalletSelect(true);
      return;
    }

    const text = chatText.trim();
    if (!text) return;
    if (text.length > 280) {
      setStatus({ type: 'err', msg: '280 characters max.' });
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
      setStatus({ type: 'ok', msg: `Inscribed. ID ${inscriptionId(newIns)} is indexing.` });
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
      setStatus({ type: 'err', msg: 'Add text or a file.' });
      return;
    }
    setShowConfirm(true);
  };

  const homeTitle = homeSection === 'museum' ? 'Museum' : homeSection === 'chat' ? 'Chat' : tab === 'profile' ? 'History' : 'Inscribe';

  return (
    <div className="min-h-screen bg-paper text-ink">
      <a href="#content" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:bg-paper focus:px-3 focus:py-2">
        Skip to content
      </a>

      <header className="sticky top-0 z-40 border-b border-rule bg-paper/95 backdrop-blur-sm">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-6 px-5 py-4">
          <a href="/" className="text-sm font-medium">BTC Inscriber</a>
          <nav aria-label="Primary" className="hidden items-center gap-5 sm:flex">
            <NavButton active={page === 'welcome'} onClick={goHome}>Home</NavButton>
            <NavButton active={page === 'home'} onClick={goInscribe}>Inscribe</NavButton>
            <NavButton active={page === 'profile'} onClick={goProfile}>Profile</NavButton>
            <NavButton active={page === 'about'} onClick={goAbout}>About</NavButton>
            <NavButton active={page === 'brc'} onClick={goBrc}>BRC</NavButton>
          </nav>
          <div className="flex items-center gap-4">
            <span className="hidden text-xs text-muted sm:inline">Mainnet</span>
            {!wallet ? (
              <button type="button" onClick={() => setShowWalletSelect(true)} className="text-sm font-medium">Connect</button>
            ) : (
              <div className="flex items-center gap-4">
                <button type="button" onClick={goProfile} className="hidden text-xs text-muted sm:block">
                  {wallet.ordAddr.slice(0, 5)}...{wallet.ordAddr.slice(-5)}
                </button>
                <button type="button" onClick={disconnectWallet} className={textBtn}>Disconnect</button>
              </div>
            )}
          </div>
        </div>
      </header>

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
          onCast={goInscribe}
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
      ) : page === 'welcome' ? (
        <WelcomePage
          profiles={profiles}
          inscriptions={inscriptions}
          wallet={wallet}
          walletInscriptions={walletInscriptions}
          currentRate={currentRate}
          onCast={goInscribe}
          onProfile={goProfile}
        />
      ) : page === 'about' ? (
        <AboutPage onHome={goHome} onCast={goInscribe} />
      ) : (
        <main id="content" className="mx-auto w-full max-w-xl px-5 pb-24 pt-16 sm:pt-24">
          <div className="mb-12 flex items-baseline justify-between gap-6">
            <h1 className="text-4xl font-medium tracking-tight">{homeTitle}</h1>
            <div className="flex gap-4">
              {homeSection !== 'inscribe' && (
                <button type="button" className={textBtn} onClick={() => setHomeSection('inscribe')}>Inscribe</button>
              )}
              {homeSection !== 'museum' && (
                <button type="button" className={textBtn} onClick={() => setHomeSection('museum')}>Museum</button>
              )}
              {homeSection !== 'chat' && (
                <button type="button" className={textBtn} onClick={() => setHomeSection('chat')}>Chat</button>
              )}
            </div>
          </div>

          {homeSection === 'inscribe' ? (
            tab === 'inscribe' ? (
              <>
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
                <HowItWorks />
              </>
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
            )
          ) : homeSection === 'museum' ? (
            <MuseumGallery inscriptions={publicGallery} profiles={profiles} />
          ) : (
            <MuseumChat
              wallet={wallet}
              profiles={profiles}
              messages={chatMessages}
              text={chatText}
              onText={setChatText}
              onSend={sendMessage}
              onConnect={() => setShowWalletSelect(true)}
            />
          )}
        </main>
      )}

      <footer className="mx-auto max-w-5xl px-5 py-12 text-sm text-muted">
        <p>BTC Inscriber · Bitcoin mainnet</p>
        <a href="https://x.com/SamSageWize" target="_blank" rel="noopener noreferrer" className="mt-2 inline-block underline decoration-rule underline-offset-4 hover:decoration-ink">
          Founder: @SamSageWize
        </a>
      </footer>

      {showCongrats && <SuccessModal lastTxid={lastTxid} onClose={() => setShowCongrats(false)} />}
      {showWalletSelect && <WalletModal onClose={() => setShowWalletSelect(false)} onXverse={connectXverse} onUnisat={connectUnisat} />}
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
    </div>
  );
}

function Frame({ children, wide = false, tall = false }: { children: ReactNode; wide?: boolean; tall?: boolean }) {
  return (
    <main id="content" className={`mx-auto w-full px-5 pb-24 ${tall ? 'flex min-h-[70vh] flex-col justify-center py-20' : 'pt-16 sm:pt-24'} ${wide ? 'max-w-5xl' : 'max-w-xl'}`}>
      {children}
    </main>
  );
}

function NavButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={`text-sm ${active ? 'text-ink underline decoration-brand underline-offset-8' : 'text-muted hover:text-ink'}`}
    >
      {children}
    </button>
  );
}

function WelcomePage({
  profiles,
  inscriptions,
  wallet,
  walletInscriptions,
  currentRate,
  onCast,
  onProfile,
}: {
  profiles: Record<string, Profile>;
  inscriptions: Inscription[];
  wallet: { type: WalletType; ordAddr: string; payAddr: string; balance: number } | null;
  walletInscriptions: Inscription[];
  currentRate: number;
  onCast: () => void;
  onProfile: () => void;
}) {
  return (
    <Frame tall>
      <p className="text-xs text-muted">Bitcoin mainnet</p>
      <h1 className="mt-3 text-4xl font-medium tracking-tight sm:text-5xl">BTC Inscriber</h1>
      <p className="mt-4 max-w-md text-base leading-7 text-muted">
        Inscribe text or a small file. Fees are shown before you sign.
      </p>
      <div className="mt-8 flex items-center gap-6">
        <button type="button" onClick={onCast} className={primary}>Inscribe</button>
        <button type="button" onClick={onProfile} className={textBtn}>Profile</button>
      </div>
      <dl className="mt-16 grid grid-cols-3 gap-6">
        <Stat label="Inscriptions" value={inscriptions.length.toLocaleString()} />
        <Stat label="Profiles" value={Object.keys(profiles).length.toLocaleString()} />
        <Stat label="Fee" value={`${currentRate} s/vB`} />
      </dl>
      {wallet && (
        <p className="mt-8 text-xs text-muted">
          {wallet.ordAddr.slice(0, 8)}...{wallet.ordAddr.slice(-8)} · {walletInscriptions.length} indexed
        </p>
      )}
    </Frame>
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
  page: 'welcome' | 'home' | 'profile' | 'brc' | 'about';
  tab: 'inscribe' | 'profile';
  walletCount: number;
  onHome: () => void;
  onInscribe: () => void;
  onProfile: () => void;
  onAbout: () => void;
  onBrc: () => void;
}) {
  const items = [
    { label: 'Home', active: page === 'welcome', onClick: onHome },
    { label: 'Inscribe', active: page === 'home' && tab === 'inscribe', onClick: onInscribe },
    { label: 'Profile', active: page === 'profile', onClick: onProfile, count: walletCount },
    { label: 'About', active: page === 'about', onClick: onAbout },
    { label: 'BRC', active: page === 'brc', onClick: onBrc },
  ];

  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-rule bg-paper px-2 py-2 sm:hidden" style={{ paddingBottom: 'calc(0.5rem + env(safe-area-inset-bottom))' }} aria-label="Mobile">
      <div className="mx-auto grid max-w-lg grid-cols-5">
        {items.map((item) => (
          <button
            key={item.label}
            type="button"
            onClick={item.onClick}
            aria-current={item.active ? 'page' : undefined}
            className={`flex min-h-12 flex-col items-center justify-center text-[0.7rem] ${item.active ? 'text-ink' : 'text-muted'}`}
          >
            <span>{item.label}</span>
            {item.count ? <span className="tabular-nums text-[0.65rem] text-muted">{item.count}</span> : null}
          </button>
        ))}
      </div>
    </nav>
  );
}

const commercialSlides = [
  { kicker: '00–03s', headline: 'Write something.', body: 'Text, an image, audio, code, or a small file.' },
  { kicker: '03–06s', headline: 'Put it on Bitcoin.', body: 'BTC Inscriber turns it into an ordinal inscription.' },
  { kicker: '06–09s', headline: 'See the cost first.', body: 'Size, speed, network fee, and service fee are shown before you sign.' },
  { kicker: '09–12s', headline: 'Keep the ID.', body: 'Each inscription has an ID you can open and verify.' },
  { kicker: '12–15s', headline: 'Find it later.', body: 'Your profile and the museum list what was inscribed here.' },
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
    <Frame>
      <p className="text-xs text-muted">{slide.kicker}</p>
      <h1 className="mt-3 text-4xl font-medium tracking-tight">{slide.headline}</h1>
      <p className="mt-4 text-base leading-7 text-muted">{slide.body}</p>
      <div className="mt-8 flex gap-3" aria-label="Slides">
        {commercialSlides.map((item, index) => (
          <button
            key={item.headline}
            type="button"
            onClick={() => setActiveSlide(index)}
            aria-current={index === activeSlide}
            aria-label={`Show slide ${index + 1}: ${item.headline}`}
            className={`h-11 w-8 text-sm tabular-nums ${index === activeSlide ? 'text-ink underline decoration-brand underline-offset-8' : 'text-muted'}`}
          >
            {index + 1}
          </button>
        ))}
      </div>
      <section className="mt-16">
        <h2 className="text-lg font-medium">What this is</h2>
        <p className="mt-3 text-sm leading-6 text-muted">
          BTC Inscriber writes a small file or some text onto Bitcoin, then lists it on your profile and in the museum.
        </p>
        <ul className="mt-6 space-y-3 text-sm leading-6">
          <li>Text, images, audio, code, and other small files.</li>
          <li>Fees shown before you sign.</li>
          <li>Profile history and a public museum.</li>
        </ul>
      </section>
      <div className="mt-10 flex items-center gap-6">
        <button type="button" onClick={onCast} className={primary}>Inscribe</button>
        <button type="button" onClick={onHome} className={textBtn}>Home</button>
      </div>
    </Frame>
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
    <Frame wide>
      <div className="flex items-baseline justify-between gap-6">
        <h1 className="text-4xl font-medium tracking-tight">BRC-20</h1>
        <button type="button" onClick={onHome} className={textBtn}>Home</button>
      </div>
      <p className="mt-4 max-w-xl text-sm leading-6 text-muted">
        Look up a 4-character ticker. This page only reads data. It does not mint, transfer, or ask for a signature.
      </p>

      <div className="mt-10 flex flex-col gap-4 sm:flex-row sm:items-end">
        <label className="block flex-1">
          <span className={label}>Ticker</span>
          <input
            value={ticker}
            onChange={(e) => onTicker(e.target.value.replace(/[^A-Za-z0-9]/g, '').slice(0, 4).toLowerCase())}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onLookup();
            }}
            placeholder="ordi"
            maxLength={4}
            className={`${field} uppercase tracking-[0.2em]`}
          />
        </label>
        <button type="button" onClick={() => onLookup()} disabled={!validTicker || loading} className={primary}>
          {loading ? 'Loading' : 'Look up'}
        </button>
      </div>

      {(error || lookup?.setupNeeded) && (
        <p role="status" className="mt-6 text-sm leading-6 text-bad">
          {error || 'Add UNISAT_API_KEY in Vercel to enable live BRC-20 indexer data.'}
        </p>
      )}

      <dl className="mt-10 grid grid-cols-2 gap-6 sm:grid-cols-4">
        <Stat label="Ticker" value={(lookup?.ticker || cleanTicker || '----').toUpperCase()} />
        <Stat label="Minted" value={formatBrcValue(minted)} />
        <Stat label="Max" value={formatBrcValue(max)} />
        <Stat label="Holders" value={formatBrcValue(holders)} />
      </dl>

      <section className="mt-12">
        <div className="flex items-baseline justify-between gap-4">
          <h2 className="text-lg font-medium">Snapshot</h2>
          {lookup?.source && <p className="text-xs text-muted">{lookup.source}</p>}
        </div>
        <div className="mt-4">
          <BrcRow label="Deploy inscription" value={formatBrcValue(deployInscription)} href={deployInscription ? `https://ordinals.com/inscription/${deployInscription}` : undefined} />
          <BrcRow label="Deployer" value={formatBrcValue(deployer)} />
          <BrcRow label="Transactions" value={formatBrcValue(transactions)} />
          <BrcRow label="Limit per mint" value={formatBrcValue(brcField(info, ['lim', 'limit', 'mintLimit']))} />
          <BrcRow label="Decimals" value={formatBrcValue(brcField(info, ['decimal', 'decimals']))} />
        </div>
      </section>

      <section className="mt-12">
        <h2 className="text-lg font-medium">Top holders</h2>
        {lookup?.holders?.length ? (
          <ul className="mt-4">
            {lookup.holders.slice(0, 8).map((holder, index) => (
              <li key={`${holder.address || index}`} className="flex items-baseline justify-between gap-4 py-2 text-sm">
                <span className="min-w-0 truncate text-muted">{holder.address || holder.owner || 'Unknown holder'}</span>
                <span className="shrink-0 tabular-nums">{formatBrcValue(holder.overallBalance || holder.balance || holder.amount)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-4 text-sm text-muted">Look up a ticker to load holders when the indexer is configured.</p>
        )}
      </section>

      <section className="mt-12 space-y-4 text-sm leading-6 text-muted">
        <p><span className="text-ink">BRC-20.</span> Original tickers are 4 letters or numbers. Balances and holders come from an indexer.</p>
        <p><span className="text-ink">Ordinals.</span> Content opens at ordinals.com by inscription ID.</p>
        <p><span className="text-ink">Runes.</span> Can be shown the same way, read-only, before any wallet action.</p>
        <p>Nothing on this screen can create a transaction, signature, mint, transfer, or listing.</p>
      </section>
    </Frame>
  );
}

function BrcRow({ label, value, href }: { label: string; value: string; href?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2 text-sm">
      <span className="text-muted">{label}</span>
      <span className="min-w-0 truncate text-right">
        {href ? (
          <a href={href} target="_blank" rel="noopener noreferrer" className="underline decoration-rule underline-offset-4 hover:decoration-ink">{value}</a>
        ) : value}
      </span>
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
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-1 text-lg tabular-nums">{value}</dd>
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
      <Frame tall>
        <h1 className="text-4xl font-medium tracking-tight">Profile</h1>
        <p className="mt-4 text-sm leading-6 text-muted">Connect a wallet to edit your name, picture, and X link, and to see inscriptions from this address.</p>
        <div className="mt-8 flex items-center gap-6">
          <button type="button" onClick={onConnect} className={primary}>Connect wallet</button>
          <button type="button" onClick={onHome} className={textBtn}>Home</button>
        </div>
      </Frame>
    );
  }

  const displayName = profile?.displayName || `${wallet.ordAddr.slice(0, 6)}...${wallet.ordAddr.slice(-4)}`;
  const avatar = draft.avatarUrl || profile?.avatarUrl;
  const confirmed = inscriptions.filter((ins) => ins.status === 'confirmed').length;
  const pending = inscriptions.filter((ins) => ins.status === 'pending' || !ins.status).length;

  return (
    <Frame wide>
      <div className="grid gap-16 lg:grid-cols-[18rem_minmax(0,1fr)]">
        <aside>
          <div className="grid h-16 w-16 place-items-center overflow-hidden rounded-full bg-rule text-sm">
            {avatar ? (
              <img src={avatar} alt="" className="h-full w-full object-cover" referrerPolicy="no-referrer" />
            ) : (
              displayName.slice(0, 1)
            )}
          </div>
          <h1 className="mt-4 text-2xl font-medium tracking-tight">{displayName}</h1>
          <p className="mt-2 break-all text-xs text-muted">{wallet.ordAddr}</p>
          {profile?.twitterUrl && (
            <a href={profile.twitterUrl} target="_blank" rel="noopener noreferrer" className="mt-3 inline-block text-sm underline decoration-rule underline-offset-4">
              Profile on X
            </a>
          )}
          <dl className="mt-6 grid grid-cols-3 gap-3">
            <Stat label="Total" value={inscriptions.length.toString()} />
            <Stat label="Confirmed" value={confirmed.toString()} />
            <Stat label="Pending" value={pending.toString()} />
          </dl>

          <div className="mt-10 space-y-5">
            <h2 className="text-lg font-medium">Edit</h2>
            <label className="block">
              <span className={label}>Name</span>
              <input value={draft.displayName} onChange={(e) => onDraft({ ...draft, displayName: e.target.value })} placeholder="Name" maxLength={40} className={field} />
            </label>
            <label className="block">
              <span className={label}>Picture URL</span>
              <input value={draft.avatarUrl} onChange={(e) => onDraft({ ...draft, avatarUrl: e.target.value })} placeholder="https://" className={field} />
            </label>
            <label className="block">
              <span className={label}>X profile</span>
              <input value={draft.twitterUrl} onChange={(e) => onDraft({ ...draft, twitterUrl: e.target.value })} placeholder="https://x.com/username" className={field} />
            </label>
            <label className="block">
              <span className={label}>Bio</span>
              <textarea value={draft.bio} onChange={(e) => onDraft({ ...draft, bio: e.target.value })} placeholder="Short bio" maxLength={240} className={`${field} min-h-28 resize-y`} />
            </label>
            <button type="button" onClick={onSave} className={primary}>Save profile</button>
            <StatusNote status={status} />
          </div>
        </aside>

        <section>
          <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
            <h2 className="text-2xl font-medium tracking-tight">History</h2>
            <label className="block sm:w-56">
              <span className="sr-only">Search inscriptions</span>
              <input value={search} onChange={(e) => onSearch(e.target.value)} placeholder="Search" className={field} />
            </label>
          </div>
          <p className="mt-3 text-sm text-muted">Inscriptions from this wallet, with their IDs.</p>
          {!filtered.length ? (
            <div className="mt-10">
              <p className="text-sm text-muted">{search ? 'No matches.' : 'No inscriptions yet.'}</p>
              <button type="button" onClick={onCast} className={`${textBtn} mt-4 underline underline-offset-4`}>Inscribe</button>
            </div>
          ) : (
            <ul className="mt-6 divide-y divide-rule">
              {filtered.map((ins) => (
                <li key={ins.wishTxid} className="py-6">
                  <InscriptionCard ins={ins} profile={profiles[ins.address]} />
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </Frame>
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
  const fees: { tier: FeeTier; name: string }[] = [
    { tier: 'slow', name: 'Slow' },
    { tier: 'med', name: 'Medium' },
    { tier: 'fast', name: 'Fast' },
    { tier: 'custom', name: 'Custom' },
  ];

  return (
    <div>
      <p className="max-w-md text-sm leading-6 text-muted">Text or a file on Bitcoin. You see the fee before you sign.</p>

      {!props.selFile ? (
        <div className="mt-10">
          <label className="inline-block cursor-pointer text-sm underline decoration-rule underline-offset-4 hover:decoration-ink focus-within:outline focus-within:outline-2 focus-within:outline-offset-4 focus-within:outline-brand">
            <input type="file" onChange={(e) => e.target.files?.[0] && props.onFile(e.target.files[0])} className="sr-only" />
            Upload a file
          </label>
          <p className="mt-2 text-sm leading-6 text-muted">PNG, JPG, GIF, WEBP, MP3, WAV, HTML, CSS, JS, JSON, TXT, MD. Max {props.maxFileSizeLabel}.</p>
        </div>
      ) : (
        <div className="mt-10 flex items-baseline justify-between gap-4">
          <div className="min-w-0">
            <p className="truncate text-sm">{props.selFile.name}</p>
            <p className="mt-1 text-xs text-muted">{(props.selFile.size / 1024).toFixed(1)} KB</p>
          </div>
          <button type="button" onClick={props.onRemoveFile} className={textBtn}>Remove</button>
        </div>
      )}

      <label className="mt-10 block">
        <span className={label}>Inscription text</span>
        <textarea value={props.wishText} onChange={(e) => props.onWishText(e.target.value)} className={`${field} min-h-32 resize-y`} placeholder="Text to inscribe" />
      </label>

      <div className="mt-10">
        <span id="fee-label" className={label}>Fee</span>
        <div role="group" aria-labelledby="fee-label" className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
          {fees.map(({ tier, name }) => (
            <button
              key={tier}
              type="button"
              aria-pressed={props.selRate === tier}
              onClick={() => props.onSelRate(tier)}
              className="py-1 text-left"
            >
              <span className={`block text-sm ${props.selRate === tier ? 'font-medium text-brand underline decoration-brand underline-offset-4' : 'text-muted'}`}>{name}</span>
              <span className="mt-1 block text-sm tabular-nums">{tier === 'custom' ? props.customRate : props.feeRates[tier]} s/vB</span>
            </button>
          ))}
        </div>
        {props.selRate === 'custom' && (
          <label className="mt-6 block max-w-xs">
            <span className={label}>Sats per vB</span>
            <input type="number" value={props.customRate} onChange={(e) => props.onCustomRate(Math.max(1, parseInt(e.target.value) || 1))} className={field} />
          </label>
        )}
      </div>

      <p className="mt-10 text-sm leading-6 text-muted">
        Service fee {SERVICE_FEE.toLocaleString()} sats. Supports the museum and profiles.
      </p>

      <dl className="mt-8 grid grid-cols-[1fr_auto] gap-x-8">
        <ReviewLine label="Content size" value={`${props.contentBytes.toLocaleString()} B`} />
        <ReviewLine label="Network fee" value={`${props.netFee.toLocaleString()} sats`} />
        <ReviewLine label="Service fee" value={`${SERVICE_FEE.toLocaleString()} sats`} />
        <ReviewLine label="Estimated total" value={`${props.totalFee.toLocaleString()} sats`} strong />
      </dl>

      <StatusNote status={props.status} />

      <div className="mt-10">
        {props.wallet ? (
          <div>
            <p className="text-xs text-muted">Wallet</p>
            <p className="mt-1 break-all text-sm">{props.wallet.ordAddr.slice(0, 8)}...{props.wallet.ordAddr.slice(-8)}</p>
            <p className={`mt-2 text-sm tabular-nums ${props.wallet.balance >= props.totalFee ? 'text-good' : 'text-bad'}`}>
              {props.wallet.balance.toLocaleString()} sats
            </p>
            <button type="button" onClick={props.onDisconnect} className={`${textBtn} mt-3 underline underline-offset-4`}>Disconnect</button>
          </div>
        ) : (
          <button type="button" onClick={props.onConnect} className={`${textBtn} underline underline-offset-4`}>Connect wallet</button>
        )}

        <button type="button" onClick={props.onInscribe} disabled={!props.canInscribe} className={`${primary} mt-8 w-full sm:w-auto`}>
          Inscribe
        </button>

        {props.progress && (
          <div className="mt-6" aria-live="polite">
            <div className="h-0.5 bg-rule">
              <div className="h-0.5 bg-brand" style={{ width: `${props.progress.p}%` }} />
            </div>
            <p className="mt-2 text-xs text-muted">{props.progress.l}</p>
          </div>
        )}
      </div>
    </div>
  );
}

function ReviewLine({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <>
      <dt className={`${strong ? 'mt-3' : ''} py-1 text-sm text-muted`}>{label}</dt>
      <dd className={`${strong ? 'mt-3 text-base font-medium' : 'text-sm'} py-1 text-right tabular-nums`}>{value}</dd>
    </>
  );
}

function StatusNote({ status }: { status: { type: 'ok' | 'err' | 'info'; msg: string } | null }) {
  if (!status) return null;
  const tone = status.type === 'ok' ? 'text-good' : status.type === 'err' ? 'text-bad' : 'text-muted';
  return <p role="status" className={`mt-4 text-sm leading-6 ${tone}`}>{status.msg}</p>;
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
      <div>
        <p className="text-sm leading-6 text-muted">Connect a wallet to see inscription IDs for that address.</p>
        <button type="button" onClick={onConnect} className={`${primary} mt-8`}>Connect wallet</button>
      </div>
    );
  }

  return (
    <div>
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <p className="text-sm text-muted">{total} from this wallet.</p>
        <label className="block sm:w-56">
          <span className="sr-only">Search history</span>
          <input value={search} onChange={(e) => onSearch(e.target.value)} placeholder="Search" className={field} />
        </label>
      </div>
      {!inscriptions.length ? (
        <div className="mt-10">
          <p className="text-sm text-muted">{search ? 'No matches.' : 'No inscriptions yet.'}</p>
          <button type="button" onClick={onCast} className={`${textBtn} mt-4 underline underline-offset-4`}>Inscribe</button>
        </div>
      ) : (
        <ul className="mt-6 divide-y divide-rule">
          {inscriptions.map((ins) => (
            <li key={ins.wishTxid} className="py-6">
              <InscriptionCard ins={ins} profile={profiles[ins.address]} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function MuseumGallery({ inscriptions, profiles }: { inscriptions: Inscription[]; profiles: Record<string, Profile> }) {
  return (
    <section>
      <p className="text-sm leading-6 text-muted">Inscriptions made on this site, with their IDs.</p>
      {!inscriptions.length ? (
        <p className="mt-8 text-sm text-muted">Nothing here yet.</p>
      ) : (
        <ul className="mt-6 divide-y divide-rule">
          {inscriptions.map((ins) => (
            <li key={ins.wishTxid} className="flex gap-4 py-5">
              <PreviewThumb ins={ins} compact />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm">{ins.wish}</p>
                <p className="mt-1 truncate text-xs text-muted">{profiles[ins.address]?.displayName || shortAddr(ins.address)}</p>
                <p className="mt-2 break-all text-xs text-muted">{inscriptionId(ins)}</p>
                <p className="mt-3 flex gap-4 text-sm">
                  <a href={ordinalsContentUrl(ins)} target="_blank" rel="noopener noreferrer" className="underline decoration-rule underline-offset-4">Content</a>
                  <a href={ordIoUrl(ins)} target="_blank" rel="noopener noreferrer" className="underline decoration-rule underline-offset-4">Ord.io</a>
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function HowItWorks() {
  return (
    <details className="mt-20">
      <summary className="cursor-pointer text-sm text-muted">How to inscribe</summary>
      <ol className="mt-4 list-decimal space-y-2 pl-5 text-sm leading-6">
        <li>Connect Xverse on Bitcoin mainnet.</li>
        <li>Add text or a file under 500KB.</li>
        <li>Choose a fee. Custom sets the rate yourself.</li>
        <li>Review the total, then sign in your wallet.</li>
        <li>The inscription ID shows on your profile and in the museum.</li>
      </ol>
    </details>
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
    <section>
      <p className="text-sm leading-6 text-muted">Messages stay with the wallet that sent them.</p>
      <div className="mt-8 max-h-80 space-y-6 overflow-y-auto">
        {!messages.length ? (
          <p className="text-sm text-muted">No messages yet.</p>
        ) : (
          messages.map((msg) => {
            const profile = profiles[msg.address];
            return (
              <article key={msg.id}>
                <div className="flex items-baseline justify-between gap-3">
                  <p className="truncate text-sm font-medium">{profile?.displayName || shortAddr(msg.address)}</p>
                  {profile?.twitterUrl && (
                    <a href={profile.twitterUrl} target="_blank" rel="noopener noreferrer" className="shrink-0 text-xs text-muted underline underline-offset-4">X</a>
                  )}
                </div>
                <p className="mt-1 text-sm leading-6">{msg.text}</p>
              </article>
            );
          })
        )}
      </div>
      {wallet ? (
        <div className="mt-8 flex items-end gap-4">
          <label className="min-w-0 flex-1">
            <span className="sr-only">Message</span>
            <input
              value={text}
              onChange={(e) => onText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') onSend();
              }}
              placeholder="Message"
              maxLength={280}
              className={field}
            />
          </label>
          <button type="button" onClick={onSend} className={primary}>Send</button>
        </div>
      ) : (
        <button type="button" onClick={onConnect} className={`${primary} mt-8`}>Connect to chat</button>
      )}
    </section>
  );
}

function InscriptionCard({ ins, profile }: { ins: Inscription; profile?: Profile }) {
  const status = ins.status === 'confirmed' ? 'Confirmed' : ins.status === 'failed' ? 'Failed' : 'Pending';
  const tone = ins.status === 'confirmed' ? 'text-good' : ins.status === 'failed' ? 'text-bad' : 'text-muted';

  return (
    <article>
      <PreviewThumb ins={ins} />
      <div className="flex items-baseline justify-between gap-4 text-xs">
        <span className="text-muted">{(ins.contentType.split('/')[1] || ins.contentType).toLowerCase()}</span>
        <span className={tone}>{status}</span>
      </div>
      <p className="mt-2 text-xs text-muted">
        {profile?.displayName || shortAddr(ins.address)}
        {profile?.twitterUrl && (
          <>
            {' · '}
            <a href={profile.twitterUrl} target="_blank" rel="noopener noreferrer" className="underline decoration-rule underline-offset-4">X</a>
          </>
        )}
      </p>
      <p className="mt-2 text-sm leading-6">{ins.wish}</p>
      <p className="mt-3 text-xs text-muted">Inscription ID</p>
      <p className="mt-1 break-all text-xs">{inscriptionId(ins)}</p>
      <p className="mt-3 flex gap-4 text-sm">
        <a href={ordinalsContentUrl(ins)} target="_blank" rel="noopener noreferrer" className="underline decoration-rule underline-offset-4">Content</a>
        <a href={ordIoUrl(ins)} target="_blank" rel="noopener noreferrer" className="underline decoration-rule underline-offset-4">Ord.io</a>
      </p>
    </article>
  );
}

function PreviewThumb({ ins, compact }: { ins: Inscription; compact?: boolean }) {
  if (!ins.contentType.startsWith('image/')) return null;
  return (
    <img
      src={ordinalsContentUrl(ins)}
      alt={ins.wish || 'Inscription'}
      className={compact ? 'h-14 w-14 shrink-0 object-cover' : 'mb-4 max-h-56 w-full object-cover'}
      referrerPolicy="no-referrer"
      onError={(e) => {
        (e.currentTarget as HTMLImageElement).style.display = 'none';
      }}
    />
  );
}

function shortAddr(address: string) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function Modal({ label, children }: { label: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 p-4 sm:items-center" role="presentation">
      <div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label={label} className="max-h-[90vh] w-full max-w-md overflow-y-auto bg-paper p-6 outline-none sm:p-8">
        {children}
      </div>
    </div>
  );
}

function SuccessModal({ lastTxid, onClose }: { lastTxid: string; onClose: () => void }) {
  const visibleInscriptionId = lastTxid.includes('i') ? lastTxid : `${lastTxid}i0`;

  return (
    <Modal label="Inscription sent">
      <h2 className="text-2xl font-medium tracking-tight">Sent</h2>
      <p className="mt-3 text-sm leading-6 text-muted">It is indexing on your profile and in the museum.</p>
      <p className="mt-6 text-xs text-muted">Inscription ID</p>
      <p className="mt-1 break-all text-sm">{visibleInscriptionId}</p>
      <p className="mt-4 flex gap-4 text-sm">
        <a href={`https://mempool.space/tx/${lastTxid}`} target="_blank" rel="noopener noreferrer" className="underline decoration-rule underline-offset-4">Transaction</a>
        <a href={`https://ord.io/${visibleInscriptionId}`} target="_blank" rel="noopener noreferrer" className="underline decoration-rule underline-offset-4">Ord.io</a>
      </p>
      <button type="button" onClick={onClose} className={`${primary} mt-8 w-full`}>Done</button>
    </Modal>
  );
}

function WalletModal({ onClose, onXverse, onUnisat }: { onClose: () => void; onXverse: () => void; onUnisat: () => void }) {
  return (
    <Modal label="Connect wallet">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="text-2xl font-medium tracking-tight">Connect</h2>
        <button type="button" onClick={onClose} className={textBtn}>Close</button>
      </div>
      <p className="mt-4 text-sm leading-6 text-muted">
        This shares a public address. Nothing is signed here. Never enter a seed phrase.
      </p>
      <div className="mt-8 border-t border-rule">
        <button type="button" onClick={onXverse} className="flex w-full items-baseline justify-between gap-4 border-b border-rule py-4 text-left">
          <span className="text-sm font-medium">Xverse</span>
          <span className="text-xs text-muted">For inscriptions</span>
        </button>
        <button type="button" onClick={onUnisat} className="flex w-full items-baseline justify-between gap-4 border-b border-rule py-4 text-left">
          <span className="text-sm font-medium">UniSat</span>
          <span className="text-xs text-muted">Connect only</span>
        </button>
      </div>
    </Modal>
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
    <Modal label="Confirm inscription">
      <h2 className="text-2xl font-medium tracking-tight">Confirm</h2>
      <p className="mt-3 text-sm leading-6 text-muted">
        Signing creates the inscription and pays the service fee. Check your wallet before you approve.
      </p>
      <dl className="mt-6 grid grid-cols-[1fr_auto] gap-x-8">
        <ReviewLine label="Content" value={props.selFile ? `File: ${props.selFile.name}` : props.wishText ? 'Text inscription' : 'Empty'} />
        <ReviewLine label="Fee rate" value={`${props.currentRate} sats/vB`} />
        <ReviewLine label="Network fee" value={`${props.netFee.toLocaleString()} sats`} />
        <ReviewLine label="Service fee" value={`${SERVICE_FEE.toLocaleString()} sats`} />
        <ReviewLine label="Total" value={`${props.totalFee.toLocaleString()} sats`} strong />
      </dl>
      <div className="mt-8 flex items-center gap-6">
        <button type="button" onClick={props.onConfirm} className={primary}>Confirm</button>
        <button type="button" onClick={props.onCancel} className={textBtn}>Cancel</button>
      </div>
    </Modal>
  );
}
