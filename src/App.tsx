import React, { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  AlertTriangle,
  Check,
  Clock,
  Coins,
  ExternalLink,
  FileText,
  History,
  Image as ImageIcon,
  LogOut,
  RefreshCw,
  Search,
  ShieldCheck,
  Upload,
  User,
  Wallet,
  X,
} from 'lucide-react';
import { FeeRates, FeeTier, Inscription, WalletType } from './types';
import { DEV_ADDR, REG_FEE, fetchBalance, fetchFeeRates, fetchTxStatus, loadSatsConnect, toB64 } from './services/bitcoinService';
import { OperationType, auth, collection, db, doc, handleFirestoreError, limit, onSnapshot, orderBy, query, setDoc, updateDoc } from './firebase';
import { onAuthStateChanged, signInAnonymously } from 'firebase/auth';

const MAX_FILE_SIZE = 60 * 1024;
const ThreeWell = React.lazy(() => import('./components/ThreeWell').then((module) => ({ default: module.ThreeWell })));

export default function App() {
  const [tab, setTab] = useState<'inscribe' | 'profile'>('inscribe');
  const [inscriptions, setInscriptions] = useState<Inscription[]>([]);
  const [selFile, setSelFile] = useState<File | null>(null);
  const [wishText, setWishText] = useState('');
  const [feeRates, setFeeRates] = useState<FeeRates>({ slow: 1, med: 2, fast: 4 });
  const [selRate, setSelRate] = useState<FeeTier>('med');
  const [customRate, setCustomRate] = useState(10);
  const [regOn, setRegOn] = useState(true);
  const [wallet, setWallet] = useState<{ type: WalletType; ordAddr: string; payAddr: string; balance: number } | null>(null);
  const [status, setStatus] = useState<{ type: 'ok' | 'err' | 'info'; msg: string } | null>(null);
  const [progress, setProgress] = useState<{ p: number; l: string } | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);
  const [showWalletSelect, setShowWalletSelect] = useState(false);
  const [showCongrats, setShowCongrats] = useState(false);
  const [lastTxid, setLastTxid] = useState('');
  const [historySearch, setHistorySearch] = useState('');

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
      setInscriptions(snapshot.docs.map((d) => d.data() as Inscription));
    }, (err) => {
      handleFirestoreError(err, OperationType.LIST, 'inscriptions');
    });

    return () => {
      unsubAuth();
      unsubSnap();
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
            if (ins.registered) {
              try {
                await updateDoc(doc(db, 'registry', ins.wishTxid), { status: newStatus });
              } catch {
                // The registry record may not exist for older inscriptions.
              }
            }
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

  const currentRate = selRate === 'custom' ? customRate : feeRates[selRate];
  const contentBytes = selFile ? selFile.size : new TextEncoder().encode(wishText).length;
  const vBytes = Math.max(160, Math.round(320 + contentBytes / 4));
  const netFee = vBytes * currentRate;
  const totalFee = netFee + (regOn ? REG_FEE : 0);
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
      || ins.contentType.toLowerCase().includes(search)
      || (ins.status || 'pending').toLowerCase().includes(search)
    ));
  }, [historySearch, walletInscriptions]);

  const recentPublic = useMemo(() => inscriptions.slice(0, 6), [inscriptions]);
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
        setStatus({ type: 'ok', msg: 'Wallet connected. Review the estimate, then inscribe when ready.' });
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
      setStatus({ type: 'ok', msg: 'UniSat connected. Xverse inscription support is live; UniSat inscription needs an API integration.' });
    } catch (err: any) {
      setStatus({ type: 'err', msg: 'UniSat connect failed: ' + err.message });
    }
  };

  const handleFile = (file: File) => {
    if (file.size > MAX_FILE_SIZE) {
      setStatus({ type: 'err', msg: 'File is too large. Keep inscriptions under 60KB for this launch.' });
      return;
    }
    setSelFile(file);
    setStatus(null);
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
            registry: regOn,
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
              appFee: regOn ? REG_FEE : undefined,
              appFeeAddress: regOn ? DEV_ADDR : undefined,
              suggestedMinerFeeRate: currentRate,
            },
            onFinish: (resp: any) => resolve({ wishTxid: resp.txId, regTxid: regOn ? resp.txId : null }),
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
        registered: regOn,
        feeRate: currentRate,
        status: 'pending',
        creatorUid: wallet.ordAddr,
        contentB64: contentType.startsWith('image/') ? contentB64 : undefined,
      };

      setProgress({ p: 76, l: 'Saving to profile history...' });

      try {
        await setDoc(doc(db, 'inscriptions', newIns.wishTxid), newIns);
        if (newIns.registered) {
          await setDoc(doc(db, 'registry', newIns.wishTxid), newIns);
        }

        await fetch('/api/track', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(newIns),
        });
      } catch (err) {
        console.error('Tracking error:', err);
      }

      setLastTxid(newIns.wishTxid);
      setShowCongrats(true);
      setProgress(null);
      setTab('profile');
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
            <span className="nav-live hidden items-center gap-2 rounded-full border border-[#50a860]/30 bg-[#50a860]/10 px-3 py-1 font-cinzel text-[0.62rem] font-bold uppercase tracking-widest text-[#70d080] sm:flex">
              Mainnet
            </span>
            {!wallet ? (
              <button onClick={() => setShowWalletSelect(true)} className="inline-flex items-center gap-2 rounded-lg border border-[#f5c842]/35 bg-[#f5c842]/10 px-4 py-2 font-cinzel text-[0.68rem] font-bold uppercase tracking-widest text-[#f5c842] transition hover:bg-[#f5c842]/18">
                <Wallet size={15} /> Connect
              </button>
            ) : (
              <div className="flex items-center gap-2">
                <button onClick={() => setTab('profile')} className="hidden rounded-lg border border-[#3a2808] bg-black/35 px-3 py-2 font-mono text-[0.72rem] text-[#c9a040] transition hover:border-[#f5c842]/40 sm:block">
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

      <main className="relative z-10 mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:py-8">
        <section className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_430px] lg:items-stretch">
          <div className="overflow-hidden rounded-[28px] border border-[#3a2808] bg-[#100904]/88 shadow-[0_24px_90px_rgba(0,0,0,0.42)]">
            <div className="grid min-h-[520px] lg:grid-cols-[minmax(0,0.95fr)_minmax(360px,1.05fr)]">
              <div className="relative min-h-[320px] overflow-hidden bg-black lg:min-h-full">
                <React.Suspense fallback={<div className="h-full min-h-[320px] bg-[radial-gradient(circle_at_center,#1a1208,#020202_70%)]" />}>
                  <ThreeWell onPlunge={() => setTab('inscribe')} compact />
                </React.Suspense>
                <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-black/10 via-transparent to-[#100904] lg:bg-gradient-to-r" />
              </div>

              <div className="flex flex-col justify-center p-6 sm:p-8">
                <div className="mb-5 inline-flex w-fit items-center gap-2 rounded-full border border-[#f5c842]/20 bg-[#f5c842]/8 px-3 py-1 font-cinzel text-[0.62rem] uppercase tracking-[0.22em] text-[#c9a040]">
                  <ShieldCheck size={13} /> Bitcoin Ordinals
                </div>
                <h1 className="font-cinzel-decorative text-[clamp(2rem,5vw,4.2rem)] leading-tight tracking-widest text-[#f5c842]">
                  Inscribe Forever
                </h1>
                <p className="mt-4 max-w-xl text-[1rem] leading-8 text-[#b89655]">
                  A cleaner home for putting text, art, and small files on Bitcoin, then finding every inscription again from your connected wallet profile.
                </p>

                <div className="mt-7 grid gap-3 sm:grid-cols-3">
                  <Stat label="Recent" value={inscriptions.length.toString()} />
                  <Stat label="Your history" value={wallet ? walletInscriptions.length.toString() : '--'} />
                  <Stat label="Fee rate" value={`${currentRate} s/vB`} />
                </div>

                <div className="mt-7 flex flex-col gap-3 sm:flex-row">
                  <button onClick={() => setTab('inscribe')} className="rounded-xl bg-gradient-to-r from-[#f5c842] to-[#c9a040] px-5 py-3 font-cinzel text-[0.75rem] font-bold uppercase tracking-[0.18em] text-black shadow-[0_0_28px_rgba(245,200,66,0.22)] transition hover:brightness-110">
                    Start Inscribing
                  </button>
                  <button onClick={() => wallet ? setTab('profile') : setShowWalletSelect(true)} className="rounded-xl border border-[#3a2808] bg-black/35 px-5 py-3 font-cinzel text-[0.75rem] font-bold uppercase tracking-[0.18em] text-[#c9a040] transition hover:border-[#f5c842]/35 hover:text-[#f5c842]">
                    View Profile History
                  </button>
                </div>
              </div>
            </div>
          </div>

          <aside className="grid gap-4">
            <ProfileSummary
              wallet={wallet}
              total={walletInscriptions.length}
              confirmed={confirmedCount}
              pending={pendingCount}
              balance={wallet?.balance || 0}
              onConnect={() => setShowWalletSelect(true)}
              onRefresh={refreshBalance}
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
              <button onClick={() => wallet ? setTab('profile') : setShowWalletSelect(true)} className={`flex items-center justify-center gap-2 rounded-lg py-2.5 font-cinzel text-[0.7rem] font-bold uppercase tracking-widest transition ${tab === 'profile' ? 'border border-[#f5c842]/25 bg-[#f5c842]/12 text-[#f5c842]' : 'text-[#7a5a25] hover:text-[#c9a040]'}`}>
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
                regOn={regOn}
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
                onRegOn={setRegOn}
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
              />
            )}
          </div>

          <div className="grid gap-5">
            <RecentInscriptions inscriptions={recentPublic} />
            <HowItWorks />
          </div>
        </section>
      </main>

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
            regOn={regOn}
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

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-[#3a2808] bg-black/28 p-3">
      <div className="font-cinzel text-[0.58rem] uppercase tracking-[0.18em] text-[#6f501f]">{label}</div>
      <div className="mt-1 font-mono text-lg text-[#f5c842]">{value}</div>
    </div>
  );
}

function ProfileSummary({ wallet, total, confirmed, pending, balance, onConnect, onRefresh }: {
  wallet: { type: WalletType; ordAddr: string; payAddr: string; balance: number } | null;
  total: number;
  confirmed: number;
  pending: number;
  balance: number;
  onConnect: () => void;
  onRefresh: () => void;
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
            <div className="font-cinzel text-[0.58rem] uppercase tracking-widest text-[#6f501f]">Connected wallet</div>
            <div className="mt-1 break-all font-mono text-[0.74rem] text-[#c9a040]">{wallet.ordAddr}</div>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <MiniStat label="Balance" value={`${balance.toLocaleString()} sats`} />
            <MiniStat label="History" value={total.toString()} />
            <MiniStat label="Confirmed" value={confirmed.toString()} />
            <MiniStat label="Pending" value={pending.toString()} />
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
        <li>Review the wallet prompt before signing. Bitcoin inscriptions are permanent.</li>
        <li>Keep files small. Smaller inscriptions are cheaper and easier to confirm.</li>
        <li>Your profile history is keyed to the connected ordinal address.</li>
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
  regOn: boolean;
  wallet: { type: WalletType; ordAddr: string; payAddr: string; balance: number } | null;
  status: { type: 'ok' | 'err' | 'info'; msg: string } | null;
  progress: { p: number; l: string } | null;
  contentBytes: number;
  netFee: number;
  totalFee: number;
  canInscribe: boolean;
  onFile: (file: File) => void;
  onRemoveFile: () => void;
  onWishText: (value: string) => void;
  onSelRate: (value: FeeTier) => void;
  onCustomRate: (value: number) => void;
  onRegOn: (value: boolean) => void;
  onConnect: () => void;
  onDisconnect: () => void;
  onInscribe: () => void;
}) {
  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_290px]">
      <div>
        <div className="mb-5">
          <h2 className="font-cinzel-decorative text-2xl tracking-widest text-[#f5c842]">Inscribe</h2>
          <p className="mt-2 text-sm leading-6 text-[#9c793c]">Write a wish, upload art, or combine both into one Bitcoin inscription.</p>
        </div>

        {!props.selFile ? (
          <label className="relative mb-4 block cursor-pointer rounded-2xl border border-dashed border-[#4a3015] bg-[#f5c842]/[0.025] p-6 text-center transition hover:border-[#f5c842]/70 hover:bg-[#f5c842]/[0.055]">
            <input type="file" onChange={(e) => e.target.files?.[0] && props.onFile(e.target.files[0])} className="absolute inset-0 cursor-pointer opacity-0" />
            <Upload className="mx-auto mb-3 text-[#c9a040]" size={30} />
            <div className="font-cinzel text-[0.78rem] font-bold uppercase tracking-widest text-[#d8b55b]">Upload content</div>
            <p className="mt-2 text-sm leading-6 text-[#7a5a25]">PNG, JPG, GIF, WEBP, TXT, JSON, HTML, or MD. Max 60KB.</p>
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

        <label className="mb-4 flex cursor-pointer items-start gap-3 rounded-2xl border border-[#342208] bg-[#f5c842]/[0.035] p-4 transition hover:border-[#5a3818]">
          <input type="checkbox" checked={props.regOn} onChange={(e) => props.onRegOn(e.target.checked)} className="mt-1 accent-[#f5c842]" />
          <span>
            <span className="block font-cinzel text-[0.78rem] text-[#c9a040]">Add to Wishing Well registry <span className="ml-1 rounded border border-[#f5c842]/25 bg-[#f5c842]/10 px-1.5 text-[0.6rem] text-[#f5c842]">+2,000 sats</span></span>
            <span className="mt-1 block text-sm leading-6 text-[#7a5a25]">Makes the inscription easier to display in profile history and future marketplace features.</span>
          </span>
        </label>

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
          {props.regOn && <ReviewLine label="Registry" value={`${REG_FEE.toLocaleString()} sats`} />}
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

function HistoryPanel({ wallet, search, inscriptions, total, onSearch, onCast, onConnect }: {
  wallet: { type: WalletType; ordAddr: string; payAddr: string; balance: number } | null;
  search: string;
  inscriptions: Inscription[];
  total: number;
  onSearch: (value: string) => void;
  onCast: () => void;
  onConnect: () => void;
}) {
  if (!wallet) {
    return (
      <div className="rounded-2xl border border-dashed border-[#3a2808] bg-black/25 p-10 text-center">
        <History className="mx-auto mb-4 text-[#6f501f]" size={42} />
        <h2 className="font-cinzel-decorative text-2xl tracking-widest text-[#f5c842]">Profile History</h2>
        <p className="mx-auto mt-3 max-w-md text-sm leading-7 text-[#9c793c]">Connect your wallet to see every inscription made from that ordinal address.</p>
        <button onClick={onConnect} className="mt-5 rounded-xl bg-[#f5c842] px-5 py-3 font-cinzel text-[0.7rem] font-bold uppercase tracking-widest text-black">Connect Wallet</button>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-5 flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
        <div>
          <h2 className="font-cinzel-decorative text-2xl tracking-widest text-[#f5c842]">Profile History</h2>
          <p className="mt-2 text-sm text-[#7a5a25]">{total} inscription{total === 1 ? '' : 's'} found for this wallet.</p>
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
              <InscriptionCard ins={ins} />
            </React.Fragment>
          ))}
        </div>
      )}
    </div>
  );
}

function RecentInscriptions({ inscriptions }: { inscriptions: Inscription[] }) {
  return (
    <section className="rounded-2xl border border-[#3a2808] bg-[#100904]/88 p-5">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-cinzel text-[0.78rem] font-bold uppercase tracking-widest text-[#f5c842]">Recent Inscriptions</h2>
        <Clock size={16} className="text-[#7a5a25]" />
      </div>
      {!inscriptions.length ? (
        <p className="rounded-xl border border-dashed border-[#2a1808] bg-black/25 p-5 text-center text-sm text-[#7a5a25]">Recent inscriptions will appear here.</p>
      ) : (
        <div className="space-y-3">
          {inscriptions.map((ins) => (
            <div key={ins.wishTxid} className="flex items-center gap-3 rounded-xl border border-[#2a1808] bg-black/25 p-3">
              <PreviewThumb ins={ins} compact />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-[#d4a040]">{ins.wish}</p>
                <p className="mt-1 font-mono text-[0.65rem] text-[#5f4218]">{ins.wishTxid.slice(0, 8)}...{ins.wishTxid.slice(-6)}</p>
              </div>
              <a href={`https://ord.io/${ins.wishTxid}i0`} target="_blank" rel="noopener noreferrer" className="text-[#7a5a25] transition hover:text-[#f5c842]">
                <ExternalLink size={14} />
              </a>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function HowItWorks() {
  const steps = [
    ['Connect', 'Use Xverse for live inscription support.'],
    ['Prepare', 'Write text, upload a small file, and choose a fee rate.'],
    ['Inscribe', 'Confirm in wallet, then track it from your profile.'],
  ];

  return (
    <section className="rounded-2xl border border-[#3a2808] bg-[#100904]/88 p-5">
      <h2 className="mb-4 font-cinzel text-[0.78rem] font-bold uppercase tracking-widest text-[#f5c842]">How It Works</h2>
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

function InscriptionCard({ ins }: { ins: Inscription }) {
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
          {ins.registered && <span className="inline-flex items-center gap-1 text-[0.54rem] uppercase tracking-widest text-[#70c070]"><Check size={9} /> Registry</span>}
        </div>
        <p className="line-clamp-2 min-h-[40px] text-sm italic leading-5 text-[#d4a040]">"{ins.wish}"</p>
        <div className="mt-3 flex items-center justify-between border-t border-[#2a1a08] pt-3">
          <a href={`https://ord.io/${ins.wishTxid}i0`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-cinzel text-[0.58rem] uppercase tracking-widest text-[#c9a040] transition hover:text-[#f5c842]">
            Ord.io <ExternalLink size={9} />
          </a>
          <span className="text-[0.62rem] text-[#5a4018]">{new Date(ins.timestamp).toLocaleDateString()}</span>
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
        src={ins.contentB64 ? `data:${ins.contentType};base64,${ins.contentB64}` : `https://ordinals.com/content/${ins.wishTxid}i0`}
        alt="Inscription content"
        className={`${size} object-cover`}
        referrerPolicy="no-referrer"
        onError={(e) => {
          (e.target as HTMLImageElement).src = 'https://picsum.photos/seed/bitcoin/400/400?blur=10';
        }}
      />
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
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/90 p-6 backdrop-blur-md">
      <motion.div initial={{ scale: 0.88, y: 20, opacity: 0 }} animate={{ scale: 1, y: 0, opacity: 1 }} exit={{ scale: 0.88, y: 20, opacity: 0 }} className="w-full max-w-md overflow-hidden rounded-3xl border border-[#f5c842]/40 bg-[#1a120a] p-8 text-center shadow-[0_0_100px_rgba(245,200,66,0.2)]">
        <div className="mx-auto mb-6 grid h-20 w-20 place-items-center rounded-full bg-gradient-to-br from-[#c9a040] to-[#f5c842] shadow-[0_0_30px_rgba(201,160,64,0.4)]">
          <Check size={40} className="text-black" strokeWidth={3} />
        </div>
        <h2 className="font-cinzel-decorative text-2xl uppercase tracking-widest text-[#f5c842]">Inscription Sent</h2>
        <p className="mt-3 text-sm leading-7 text-[#9c793c]">Your inscription was submitted and added to your profile history.</p>
        <div className="my-6 flex items-center justify-center gap-4 rounded-2xl border border-[#3a2808] bg-black/40 p-4">
          <a href={`https://mempool.space/tx/${lastTxid}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-cinzel text-[0.65rem] uppercase tracking-widest text-[#c9a040] hover:text-[#f5c842]">View Tx <ExternalLink size={10} /></a>
          <a href={`https://ord.io/${lastTxid}i0`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-cinzel text-[0.65rem] uppercase tracking-widest text-[#c9a040] hover:text-[#f5c842]">View Ord <ExternalLink size={10} /></a>
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
  regOn: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/80 px-4 backdrop-blur-sm">
      <motion.div initial={{ scale: 0.92, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.92, y: 20 }} className="w-full max-w-md rounded-2xl border border-[#f5c842]/30 bg-[#1a120a] p-6 shadow-[0_0_50px_rgba(0,0,0,0.5)]">
        <h3 className="mb-6 flex items-center justify-center gap-2 text-center font-cinzel uppercase tracking-widest text-[#f5c842]">
          <AlertTriangle size={18} /> Confirm Inscription
        </h3>
        <div className="mb-8 space-y-4 text-sm">
          <ReviewLine label="Content" value={props.selFile ? `File: ${props.selFile.name}` : props.wishText ? 'Text inscription' : 'Empty'} />
          <ReviewLine label="Fee rate" value={`${props.currentRate} sats/vB`} />
          <ReviewLine label="Network fee" value={`${props.netFee.toLocaleString()} sats`} />
          {props.regOn && <ReviewLine label="Registry fee" value={`${REG_FEE.toLocaleString()} sats`} />}
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
