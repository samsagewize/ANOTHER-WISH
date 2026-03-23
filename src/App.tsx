import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { LucideIcon, Coins, Scroll, Upload, X, Check, AlertTriangle, ExternalLink, Wallet, User, LogOut, ChevronDown } from 'lucide-react';
import { ThreeWell } from './components/ThreeWell';
import { PlungeSplash } from './components/PlungeSplash';
import { Inscription, FeeTier, FeeRates, WalletType } from './types';
import { fetchFeeRates, fetchBalance, toB64, loadSatsConnect, DEV_ADDR, REG_FEE } from './services/bitcoinService';
import { db, auth, collection, doc, setDoc, onSnapshot, query, orderBy, limit, OperationType, handleFirestoreError } from './firebase';
import { signInAnonymously, onAuthStateChanged, User as FirebaseUser } from 'firebase/auth';

const REG_KEY = 'bww_mainnet_v1';

export default function App() {
  const [view, setView] = useState<'intro' | 'plunge' | 'ui'>('intro');
  const [tab, setTab] = useState<'gallery' | 'cast' | 'inscriptions'>('gallery');
  const [inscriptions, setInscriptions] = useState<Inscription[]>([]);
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [selFile, setSelFile] = useState<File | null>(null);
  const [wishText, setWishText] = useState('');
  const [feeRates, setFeeRates] = useState<FeeRates>({ slow: 1, med: 2, fast: 4 });
  const [selRate, setSelRate] = useState<FeeTier>('med');
  const [regOn, setRegOn] = useState(false);
  const [wallet, setWallet] = useState<{ type: WalletType; ordAddr: string; payAddr: string; balance: number } | null>(null);
  const [status, setStatus] = useState<{ type: 'ok' | 'err' | 'info'; msg: string } | null>(null);
  const [progress, setProgress] = useState<{ p: number; l: string } | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);
  const [showWalletSelect, setShowWalletSelect] = useState(false);

  useEffect(() => {
    fetchFeeRates().then(setFeeRates);

    // Sync Inscriptions from Firestore
    const q = query(collection(db, 'inscriptions'), orderBy('timestamp', 'desc'), limit(100));
    const unsubSnap = onSnapshot(q, (snapshot) => {
      const list = snapshot.docs.map(d => d.data() as Inscription);
      setInscriptions(list);
    }, (err) => {
      handleFirestoreError(err, OperationType.LIST, 'inscriptions');
    });

    return () => {
      unsubSnap();
    };
  }, []);

  const updateBalance = async (addr: string) => {
    const bal = await fetchBalance(addr);
    if (wallet) setWallet({ ...wallet, balance: bal });
  };

  const connectXverse = async () => {
    try {
      setShowWalletSelect(false);
      const sc = await loadSatsConnect();
      const { request, AddressPurpose } = sc;
      const resp = await request('wallet_connect', {
        addresses: [AddressPurpose.Ordinals, AddressPurpose.Payment],
        message: 'Bitcoin Wishing Well — connect to inscribe on mainnet',
        network: 'Mainnet',
      });

      if (resp.status === 'success') {
        const addrs = resp.result.addresses;
        const ord = addrs.find((a: any) => a.purpose === AddressPurpose.Ordinals) || addrs[0];
        const pay = addrs.find((a: any) => a.purpose === AddressPurpose.Payment) || ord;
        const bal = await fetchBalance(pay.address);
        setWallet({ type: 'xverse', ordAddr: ord.address, payAddr: pay.address, balance: bal });
        setStatus(null);
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
      setStatus(null);
    } catch (err: any) {
      setStatus({ type: 'err', msg: 'UniSat connect failed: ' + err.message });
    }
  };

  const executeInscribe = async () => {
    if (!wallet) {
      setStatus({ type: 'err', msg: 'Wallet not connected.' });
      return;
    }
    setProgress({ p: 0, l: 'Preparing inscription...' });
    try {
      let contentType, contentB64;
      if (selFile) {
        const rawB64 = await toB64(selFile);
        if (wishText) {
          // If both file and text, we still use JSON to link them, but user specifically asked for "just text" cases
          const meta = { wish: wishText, fileName: selFile.name, fileType: selFile.type, fileData: rawB64, app: 'bitcoin-wishing-well-v1', registry: regOn };
          contentType = 'application/json'; contentB64 = btoa(JSON.stringify(meta));
        } else {
          contentType = selFile.type || 'application/octet-stream'; contentB64 = rawB64;
        }
      } else {
        // Just text: use plain text as requested
        contentType = 'text/plain;charset=utf-8';
        contentB64 = btoa(unescape(encodeURIComponent(wishText)));
      }

      setProgress({ p: 30, l: 'Confirm in wallet...' });

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
              suggestedMinerFeeRate: feeRates[selRate],
            },
            onFinish: (resp: any) => resolve({ wishTxid: resp.txId, regTxid: regOn ? resp.txId : null }),
            onCancel: () => reject(new Error('Cancelled')),
          });
        });
      } else {
        throw new Error('UniSat inscription requires API key integration.');
      }

      const newIns: Inscription = {
        wish: wishText || (selFile ? `[file: ${selFile.name}]` : ''),
        contentType,
        wishTxid: result.wishTxid,
        regTxid: result.regTxid,
        address: wallet.ordAddr,
        timestamp: Date.now(),
        registered: regOn,
        feeRate: feeRates[selRate],
        status: 'pending',
        creatorUid: wallet.ordAddr, // Use wallet address as identifier
        contentB64: contentType.startsWith('image/') ? contentB64 : undefined,
      };

      // Save to Firestore
      try {
        await setDoc(doc(db, 'inscriptions', newIns.wishTxid), newIns);
        
        // Track in backend JSON file
        await fetch('/api/track', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(newIns)
        });
      } catch (err) {
        console.error('Tracking error:', err);
      }

      setLastTxid(newIns.wishTxid);
      setShowCongrats(true);
      setProgress(null);
      setTab('inscriptions');
    } catch (err: any) {
      setStatus({ type: 'err', msg: 'Failed: ' + err.message });
      setProgress(null);
    }
  };

  const [showCongrats, setShowCongrats] = useState(false);
  const [lastTxid, setLastTxid] = useState('');

  const handleInscribe = () => {
    if (!wallet) return;
    setShowConfirm(true);
  };

  const vBytes = Math.round(160 + 160 + (selFile ? selFile.size : new TextEncoder().encode(wishText).length) / 4);
  const netFee = vBytes * feeRates[selRate];
  const totalFee = netFee + (regOn ? REG_FEE : 0);

  return (
    <div className="min-h-screen bg-black text-[#e8d5a3] font-lora">
      <nav className="fixed top-0 left-0 right-0 z-[9999] flex items-center justify-between px-4 sm:px-8 py-3 bg-[rgba(6,4,1,0.95)] border-b border-[rgba(245,200,66,0.1)] backdrop-blur-xl">
        <a href="/" className="nav-logo font-cinzel-decorative text-sm sm:text-base text-[#f5c842] tracking-widest">⊕ Bitcoin Wishing Well</a>
        <div className="flex items-center gap-2 sm:gap-4">
          <div className="hidden md:flex items-center gap-3">
            <span className="font-cinzel text-[0.63rem] font-semibold tracking-widest uppercase text-[#7a5a25] border border-[rgba(245,200,66,0.15)] rounded-full px-3 py-1">Ordinals</span>
            <span className="nav-live font-cinzel text-[0.63rem] font-bold tracking-widest uppercase text-[#50a860] border border-[rgba(80,168,96,0.3)] bg-[rgba(80,168,96,0.07)] rounded-full px-4 py-1 flex items-center gap-2">Mainnet</span>
          </div>

          {!wallet ? (
            <button 
              onClick={() => setShowWalletSelect(true)}
              className="font-cinzel text-[0.65rem] font-bold tracking-widest uppercase text-[#f5c842] bg-[rgba(245,200,66,0.1)] border border-[rgba(245,200,66,0.3)] rounded-lg px-4 py-2 hover:bg-[rgba(245,200,66,0.2)] transition-all flex items-center gap-2"
            >
              <Wallet size={14} /> Connect
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <button 
                onClick={() => setTab('inscriptions')}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg border transition-all ${tab === 'inscriptions' ? 'bg-[rgba(245,200,66,0.15)] border-[#f5c842]/40 text-[#f5c842]' : 'bg-black/40 border-[#3a2808] text-[#7a5a25] hover:text-[#c9a040]'}`}
              >
                <User size={14} />
                <span className="hidden sm:inline font-cinzel text-[0.65rem] font-bold tracking-widest uppercase">Profile</span>
              </button>
              <div className="h-8 w-px bg-[#3a2808] mx-1 hidden sm:block" />
              <div className="flex items-center gap-2 bg-black/40 border border-[#3a2808] rounded-lg px-3 py-2">
                <span className="text-[0.68rem] text-[#c9a040] font-mono hidden sm:inline">{wallet.ordAddr.slice(0, 4)}...{wallet.ordAddr.slice(-4)}</span>
                <button onClick={() => setWallet(null)} className="text-[#7a5a25] hover:text-[#cc5050] transition-colors">
                  <LogOut size={14} />
                </button>
              </div>
            </div>
          )}
        </div>
      </nav>

      <div className="pt-12">
        <AnimatePresence mode="wait">
          {view === 'intro' && (
            <motion.div key="intro" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <ThreeWell onPlunge={() => setView('plunge')} />
            </motion.div>
          )}

          {view === 'plunge' && (
            <motion.div key="plunge" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <PlungeSplash onComplete={() => setView('ui')} />
            </motion.div>
          )}

          {view === 'ui' && (
            <motion.main key="ui" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="relative z-10 min-h-[calc(100vh-48px)] bg-[radial-gradient(ellipse_at_50%_0%,#140e04_0%,#070401_70%)]">
              <div className="max-w-[560px] mx-auto px-5 py-8 pb-20">
                <div className="flex gap-1 bg-black/35 border border-[#221508] rounded-xl p-1 mb-6">
                  <button onClick={() => setTab('gallery')} className={`flex-1 flex items-center justify-center gap-2 font-cinzel text-[0.68rem] font-semibold tracking-widest uppercase py-2 rounded-lg transition-all ${tab === 'gallery' ? 'text-[#f5c842] bg-[rgba(245,200,66,0.1)] border border-[rgba(245,200,66,0.22)]' : 'text-[#7a5a25] hover:text-[#c9a040]'}`}>
                    <Scroll size={14} /> The Well
                  </button>
                  <button onClick={() => setTab('cast')} className={`flex-1 flex items-center justify-center gap-2 font-cinzel text-[0.68rem] font-semibold tracking-widest uppercase py-2 rounded-lg transition-all ${tab === 'cast' ? 'text-[#f5c842] bg-[rgba(245,200,66,0.1)] border border-[rgba(245,200,66,0.22)]' : 'text-[#7a5a25] hover:text-[#c9a040]'}`}>
                    <Coins size={14} /> Cast a Wish
                  </button>
                  <button onClick={() => setTab('inscriptions')} className={`flex-1 flex items-center justify-center gap-2 font-cinzel text-[0.68rem] font-semibold tracking-widest uppercase py-2 rounded-lg transition-all ${tab === 'inscriptions' ? 'text-[#f5c842] bg-[rgba(245,200,66,0.1)] border border-[rgba(245,200,66,0.22)]' : 'text-[#7a5a25] hover:text-[#c9a040]'}`}>
                    <User size={14} /> Profile <span className="bg-[rgba(245,200,66,0.15)] border border-[rgba(245,200,66,0.28)] rounded-full text-[0.58rem] px-1.5 min-w-[18px] text-center">{inscriptions.filter(ins => ins.address === wallet?.ordAddr).length}</span>
                  </button>
                </div>

                {tab === 'gallery' && (
                  <div className="space-y-6">
                    <div className="text-center mb-8">
                      <h2 className="font-cinzel text-xl text-[#f5c842] tracking-[0.2em] uppercase mb-2">The Eternal Well</h2>
                      <p className="text-[#7a5a25] italic text-sm">Wishes sealed in the bedrock of Bitcoin.</p>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
                      {/* Combined Feed: Only Real Inscriptions */}
                      {inscriptions.length === 0 ? (
                        <div className="col-span-full text-center py-12 text-[#3a2808] italic text-[0.85rem]">
                          <Coins size={48} className="mx-auto mb-3 opacity-35" />
                          The well is quiet. Be the first to cast a wish.
                        </div>
                      ) : (
                        inscriptions.sort((a, b) => b.timestamp - a.timestamp).map((item, idx) => (
                          <div key={idx} className={`bg-gradient-to-br from-[#130e06] to-[#0d0804] border border-[#2a1a08] rounded-xl overflow-hidden group hover:border-[#f5c842]/30 transition-all ${wallet?.ordAddr === item.address ? 'border-l-2 border-l-[#f5c842]' : ''}`}>
                            <div className="relative aspect-square w-full bg-[#0a0602] overflow-hidden group-hover:border-[#f5c842]/20 transition-all">
                              {item.contentType.startsWith('image/') ? (
                                <img 
                                  src={item.contentB64 ? `data:${item.contentType};base64,${item.contentB64}` : `https://ordinals.com/content/${item.wishTxid}i0`} 
                                  alt="Inscription content" 
                                  className="w-full h-full object-cover"
                                  referrerPolicy="no-referrer"
                                  onError={(e) => {
                                    // Fallback if ordinals.com is slow and we don't have b64
                                    if (!item.contentB64) {
                                      (e.target as HTMLImageElement).src = 'https://picsum.photos/seed/bitcoin/400/400?blur=10';
                                    }
                                  }}
                                />
                              ) : (
                                <div className="w-full h-full p-4 flex items-center justify-center text-center">
                                  <p className="text-[#e8d5a3] italic text-sm font-lora line-clamp-4">"{item.wish}"</p>
                                </div>
                              )}
                              {item.status === 'pending' && (
                                <div className="absolute top-2 left-2 z-10">
                                  <span className="bg-[#f5c842] text-black text-[0.45rem] px-1.5 py-0.5 rounded font-bold uppercase animate-pulse">Pending Indexing</span>
                                </div>
                              )}
                              <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-60" />
                              <div className="absolute bottom-2 left-2 right-2 flex justify-between items-end">
                                <div className="flex flex-col gap-0.5">
                                  <span className="text-[0.5rem] font-cinzel text-[#f5c842] tracking-widest uppercase">{new Date(item.timestamp).toLocaleDateString()}</span>
                                  <span className="text-[0.5rem] font-mono text-[#7a5a25]">{item.wishTxid.slice(0, 4)}...{item.wishTxid.slice(-4)}</span>
                                </div>
                                <div className="flex gap-1">
                                  <a href={`https://ord.io/${item.wishTxid}i0`} target="_blank" className="p-1 bg-black/40 rounded hover:bg-[#f5c842]/20 transition-colors">
                                    <ExternalLink size={10} className="text-[#f5c842]" />
                                  </a>
                                </div>
                              </div>
                            </div>
                            <div className="p-3">
                              <div className="flex items-center justify-between mb-2">
                                {item.registered ? (
                                  <div className="flex items-center gap-1 text-[#50a860]">
                                    <Check size={8} />
                                    <span className="text-[0.45rem] font-cinzel tracking-tighter uppercase">Reg</span>
                                  </div>
                                ) : (
                                  <span className="text-[0.45rem] font-cinzel text-[#7a5a25] tracking-tighter uppercase">Unreg</span>
                                )}
                                <span className="text-[0.45rem] font-cinzel text-[#7a5a25] tracking-tighter uppercase">₿ Mainnet</span>
                              </div>
                              <p className="text-[#e8d5a3] italic text-[0.7rem] font-lora line-clamp-2 leading-tight">"{item.wish}"</p>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                )}

                {tab === 'cast' ? (
                  <div className="bg-gradient-to-br from-[#1a120a] to-[#0f0905] border border-[#3a2808] rounded-2xl p-6 relative overflow-hidden">
                    <div className="absolute top-0 left-[10%] right-[10%] h-px bg-gradient-to-r from-transparent via-[rgba(245,200,66,0.42)] to-transparent" />
                    <h2 className="font-cinzel text-[0.88rem] font-bold text-[#f5c842] text-center tracking-widest uppercase mb-5">⟡ Cast Your Wish ⟡</h2>

                    {!selFile ? (
                      <div className="border-[1.5px] border-dashed border-[#3a2808] rounded-xl p-6 text-center cursor-pointer bg-[rgba(245,200,66,0.02)] hover:border-[#f5c842] hover:bg-[rgba(245,200,66,0.05)] transition-all mb-4 relative">
                        <input type="file" onChange={(e) => e.target.files?.[0] && setSelFile(e.target.files[0])} className="absolute inset-0 opacity-0 cursor-pointer" />
                        <Upload className="mx-auto mb-2 text-[#c9a040]" />
                        <p className="text-[0.82rem] text-[#8a6a30] leading-relaxed"><strong>Drop a file here</strong><br />image or text to inscribe on Bitcoin<br /><span className="text-[0.68rem] text-[#4a3015]">PNG · JPG · GIF · WEBP · TXT · JSON · HTML · MD — max 60KB</span></p>
                      </div>
                    ) : (
                      <div className="flex items-center gap-3 bg-[rgba(245,200,66,0.04)] border border-[#2a1808] rounded-lg p-3 mb-4">
                        <div className="w-10 h-10 bg-[#1a1208] border border-[#3a2808] rounded flex items-center justify-center text-xl">📄</div>
                        <div className="flex-1 min-w-0">
                          <p className="text-[0.8rem] text-[#d4a040] truncate">{selFile.name}</p>
                          <p className="text-[0.7rem] text-[#6a4a1a]">{(selFile.size / 1024).toFixed(1)} KB</p>
                        </div>
                        <button onClick={() => setSelFile(null)} className="text-[#5a3a10] hover:text-[#e06030] transition-colors"><X size={18} /></button>
                      </div>
                    )}

                    <div className="mb-4">
                      <label className="block font-cinzel text-[0.72rem] text-[#7a5a25] tracking-widest uppercase mb-1.5">Your wish</label>
                      <textarea value={wishText} onChange={(e) => setWishText(e.target.value)} className="w-full bg-black/35 border border-[#2a1808] rounded-lg text-[#e8d5a3] font-lora italic text-[0.88rem] p-3 h-20 outline-none focus:border-[#c9a040] transition-colors placeholder:text-[#4a3018]" placeholder="Write your wish... it shall be sealed forever in Bitcoin's stone." />
                    </div>

                    <div className="mb-4">
                      <span className="block font-cinzel text-[0.72rem] text-[#7a5a25] tracking-widest uppercase mb-2">Network fee rate</span>
                      <div className="grid grid-cols-3 gap-2">
                        {(['slow', 'med', 'fast'] as FeeTier[]).map((tier) => (
                          <button key={tier} onClick={() => setSelRate(tier)} className={`bg-black/30 border rounded-lg p-2 transition-all text-center ${selRate === tier ? 'border-[#c9a040] bg-[rgba(245,200,66,0.07)]' : 'border-[#2a1808] hover:border-[#5a3a18]'}`}>
                            <span className={`block font-cinzel text-[0.63rem] font-bold uppercase mb-1 ${selRate === tier ? 'text-[#f5c842]' : 'text-[#7a5a25]'}`}>{tier}</span>
                            <span className="text-[0.76rem] text-[#c9a040] font-medium">{feeRates[tier]} s/vB</span>
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="mb-4 space-y-1">
                      <div className="flex justify-between text-[0.72rem] font-cinzel text-[#6a4a20] tracking-wider"><span>Inscription size</span><span className="text-[#c9a040]">{(selFile ? selFile.size : new TextEncoder().encode(wishText).length)} B</span></div>
                      <div className="flex justify-between text-[0.72rem] font-cinzel text-[#6a4a20] tracking-wider"><span>Network fee</span><span className="text-[#c9a040]">{netFee.toLocaleString()} sats</span></div>
                      {regOn && (
                        <div className="flex justify-between text-[0.72rem] font-cinzel text-[#6a4a20] tracking-wider">
                          <span>Registry fee ({((REG_FEE / totalFee) * 100).toFixed(1)}%)</span>
                          <span className="text-[#c9a040]">{REG_FEE.toLocaleString()} sats</span>
                        </div>
                      )}
                      <div className="flex justify-between items-center border-t border-[#2a1808] pt-2 mt-1">
                        <span className="text-[0.78rem] font-cinzel text-[#a08040]">Est. Total</span>
                        <span className="text-[0.9rem] font-bold text-[#f5c842]">{totalFee.toLocaleString()} sats</span>
                      </div>
                    </div>

                    <label className="flex items-start gap-3 bg-[rgba(245,200,66,0.035)] border border-[#342208] rounded-xl p-4 mb-4 cursor-pointer hover:border-[#5a3818] hover:bg-[rgba(245,200,66,0.065)] transition-all">
                      <input type="checkbox" checked={regOn} onChange={(e) => setRegOn(e.target.checked)} className="mt-1 accent-[#f5c842]" />
                      <div>
                        <div className="font-cinzel text-[0.78rem] text-[#c9a040] tracking-wider mb-1">Register for Future Marketplace <span className="bg-[rgba(245,200,66,0.1)] border border-[rgba(245,200,66,0.28)] rounded px-1.5 text-[0.6rem] text-[#f5c842] ml-1">+2,000 sats</span></div>
                        <p className="text-[0.72rem] text-[#7a5a25] leading-relaxed">Add your wish to the on-chain registry so it can be indexed and listed in the Bitcoin Wishing Well marketplace when it launches.</p>
                      </div>
                    </label>

                    <div className="flex items-center gap-2 my-4 text-[#3a2808] text-[0.7rem] font-cinzel tracking-widest uppercase before:flex-1 before:h-px before:bg-gradient-to-r before:from-transparent before:to-[#3a2808] after:flex-1 after:h-px after:bg-gradient-to-l after:from-transparent after:to-[#3a2808]">Connect Wallet</div>

                    <div className="space-y-3 mb-6">
                      {!wallet ? (
                        <div className="flex gap-2">
                          <button onClick={connectXverse} className="flex-1 bg-gradient-to-br from-[#1c1208] to-[#130d05] border border-[#3a2808] rounded-lg text-[#b09040] font-cinzel text-[0.7rem] font-bold tracking-wider py-2.5 hover:border-[#c9a040] hover:text-[#f5c842] transition-all uppercase flex items-center justify-center gap-2"><span>🔶</span> Xverse</button>
                          <button onClick={connectUnisat} className="flex-1 bg-gradient-to-br from-[#1c1208] to-[#130d05] border border-[#3a2808] rounded-lg text-[#b09040] font-cinzel text-[0.7rem] font-bold tracking-wider py-2.5 hover:border-[#c9a040] hover:text-[#f5c842] transition-all uppercase flex items-center justify-center gap-2"><span>🔷</span> UniSat</button>
                        </div>
                      ) : (
                        <div className="space-y-2">
                          <div className="flex items-center justify-between bg-black/20 border border-[#221508] rounded-lg px-3 py-2">
                            <span className="text-[0.68rem] font-cinzel text-[#5a4018] tracking-widest uppercase">Wallet</span>
                            <span className="text-[0.73rem] text-[#c9a040] font-mono">{wallet.ordAddr.slice(0, 8)}...{wallet.ordAddr.slice(-8)}</span>
                          </div>
                          <div className="flex items-center justify-between bg-black/20 border border-[#221508] rounded-lg px-3 py-2">
                            <span className="text-[0.68rem] font-cinzel text-[#5a4018] tracking-widest uppercase">Balance</span>
                            <span className={`text-[0.73rem] font-mono ${wallet.balance >= totalFee ? 'text-[#50a860]' : 'text-[#cc5050]'}`}>{wallet.balance.toLocaleString()} sats</span>
                          </div>
                          <button onClick={() => setWallet(null)} className="text-[0.63rem] text-[#6a3a18] font-cinzel tracking-widest uppercase underline block mx-auto">Disconnect</button>
                        </div>
                      )}
                    </div>

                    <button disabled={!wallet || (!selFile && !wishText)} onClick={handleInscribe} className="w-full bg-gradient-to-br from-[#7a4e00] to-[#4a3000] border-[1.5px] border-[#b09030] rounded-xl text-[#ffe890] font-cinzel text-[0.92rem] font-bold tracking-widest py-4 uppercase transition-all hover:border-[#f5c842] hover:shadow-[0_0_22px_rgba(245,200,66,0.28)] hover:-translate-y-0.5 disabled:opacity-35 disabled:cursor-not-allowed disabled:transform-none flex items-center justify-center gap-2 relative overflow-hidden group">
                      <div className="absolute inset-0 bg-gradient-to-br from-white/15 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                      <Coins size={20} /> Make Your Wish & Inscribe
                    </button>

                    {progress && (
                      <div className="mt-4">
                        <div className="h-1 bg-[#1a1008] rounded-full overflow-hidden">
                          <div className="h-full bg-gradient-to-r from-[#c9a040] to-[#f5c842] transition-all duration-500" style={{ width: `${progress.p}%` }} />
                        </div>
                        <p className="text-[0.7rem] text-[#6a4a18] text-center mt-1.5 font-cinzel tracking-widest">{progress.l}</p>
                      </div>
                    )}

                    {status && (
                      <div className={`mt-4 rounded-lg p-3 text-[0.8rem] leading-relaxed border ${status.type === 'ok' ? 'border-[#285028] bg-[rgba(40,100,40,0.07)] text-[#60aa60]' : status.type === 'err' ? 'border-[#502020] bg-[rgba(100,30,30,0.07)] text-[#cc6060]' : 'border-[#3a2808] bg-[rgba(60,30,5,0.07)] text-[#a08040]'}`}>
                        {status.msg}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="font-cinzel text-[0.75rem] text-[#7a5a25] tracking-widest uppercase">Your Inscriptions</h3>
                    </div>
                    {inscriptions.filter(ins => ins.address === wallet?.ordAddr).length === 0 ? (
                      <div className="text-center py-12 text-[#3a2808] italic text-[0.85rem] bg-black/20 rounded-xl border border-dashed border-[#2a1a08]">
                        <Coins size={48} className="mx-auto mb-3 opacity-35" />
                        <p className="mb-4">No wishes found for this wallet.</p>
                        <button 
                          onClick={() => setTab('cast')}
                          className="text-[#c9a040] hover:underline font-cinzel text-[0.7rem] tracking-widest uppercase"
                        >
                          Cast your first wish →
                        </button>
                      </div>
                    ) : (
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                        {inscriptions.filter(ins => ins.address === wallet?.ordAddr).map((ins, i) => (
                          <div key={i} className="bg-gradient-to-br from-[#130e06] to-[#0d0804] border border-[#2a1a08] rounded-xl overflow-hidden group hover:border-[#3a2a12] transition-all relative">
                            <div className="aspect-square w-full bg-black/40 overflow-hidden relative">
                              {ins.contentType.startsWith('image/') ? (
                                <img 
                                  src={ins.contentB64 ? `data:${ins.contentType};base64,${ins.contentB64}` : `https://ordinals.com/content/${ins.wishTxid}i0`} 
                                  alt="Inscription content" 
                                  className="w-full h-full object-cover"
                                  referrerPolicy="no-referrer"
                                  onError={(e) => {
                                    if (!ins.contentB64) {
                                      (e.target as HTMLImageElement).src = 'https://picsum.photos/seed/bitcoin/400/400?blur=10';
                                    }
                                  }}
                                />
                              ) : (
                                <div className="w-full h-full p-3 flex items-center justify-center text-center">
                                  <p className="text-[0.65rem] text-[#d4a040] italic leading-relaxed line-clamp-4">"{ins.wish}"</p>
                                </div>
                              )}
                              <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-60" />
                              <div className="absolute top-2 right-2">
                                {ins.status === 'pending' && (
                                  <span className="bg-[#f5c842] text-black text-[0.45rem] px-1.5 py-0.5 rounded font-bold uppercase animate-pulse">Pending Indexing</span>
                                )}
                              </div>
                            </div>

                            <div className="p-3">
                              <div className="flex items-center justify-between mb-2">
                                <span className="text-[0.45rem] font-cinzel text-[#7a5a25] tracking-tighter uppercase">{(ins.contentType.split('/')[1] || ins.contentType).toUpperCase()}</span>
                                {ins.registered && (
                                  <div className="flex items-center gap-0.5 text-[#55d070]">
                                    <Check size={8} />
                                    <span className="text-[0.45rem] font-cinzel tracking-tighter uppercase">Reg</span>
                                  </div>
                                )}
                              </div>
                              <p className="text-[#d4a040] italic text-[0.65rem] line-clamp-2 mb-2">"{ins.wish}"</p>
                              <div className="flex items-center justify-between border-t border-[#2a1a08] pt-2 mt-2">
                                <a href={`https://ord.io/${ins.wishTxid}i0`} target="_blank" className="text-[0.55rem] font-cinzel text-[#c9a040] hover:text-[#f5c842] transition-colors uppercase tracking-widest flex items-center gap-1">
                                  Ord.io <ExternalLink size={8} />
                                </a>
                                <span className="text-[0.5rem] text-[#3a2808]">{new Date(ins.timestamp).toLocaleDateString()}</span>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

              <footer className="text-center py-8 border-t border-[rgba(245,200,66,0.06)]">
                <div className="font-cinzel text-[0.62rem] text-[#3a2808] tracking-[0.1em] uppercase leading-loose">
                  Bitcoin Wishing Well &nbsp;·&nbsp; Bitcoin Mainnet · Ordinals Protocol<br />
                  <a href="https://ordinals.com" target="_blank" className="text-[#5a4018] hover:text-[#c9a040] transition-colors">ordinals.com</a> &nbsp;·&nbsp;
                  <a href="https://mempool.space" target="_blank" className="text-[#5a4018] hover:text-[#c9a040] transition-colors">mempool.space</a> &nbsp;·&nbsp;
                  <a href="https://xverse.app" target="_blank" className="text-[#5a4018] hover:text-[#c9a040] transition-colors">xverse.app</a>
                </div>
              </footer>
            </motion.main>
          )}
        </AnimatePresence>
      </div>

      <AnimatePresence>
        {showCongrats && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[10000] flex items-center justify-center p-6 bg-black/90 backdrop-blur-md">
            <motion.div initial={{ scale: 0.8, y: 20, opacity: 0 }} animate={{ scale: 1, y: 0, opacity: 1 }} className="bg-[#1a120a] border border-[#f5c842]/40 rounded-3xl p-8 max-w-md w-full shadow-[0_0_100px_rgba(245,200,66,0.2)] text-center relative overflow-hidden">
              <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-transparent via-[#f5c842] to-transparent" />
              <div className="w-20 h-20 bg-gradient-to-br from-[#c9a040] to-[#f5c842] rounded-full flex items-center justify-center mx-auto mb-6 shadow-[0_0_30px_rgba(201,160,64,0.4)]">
                <Check size={40} className="text-black" strokeWidth={3} />
              </div>
              <h2 className="font-cinzel-decorative text-2xl text-[#f5c842] tracking-widest uppercase mb-2">Wish Cast Successfully!</h2>
              <p className="text-[#7a5a25] font-cinzel text-[0.7rem] tracking-[0.2em] uppercase mb-6">The Well Has Received Your Offering</p>
              
              <div className="bg-black/40 border border-[#3a2808] rounded-2xl p-4 mb-8">
                <p className="text-[0.85rem] text-[#e8d5a3] italic mb-4 leading-relaxed">"Your wish is now being etched into the eternal ledger of Bitcoin."</p>
                <div className="flex items-center justify-center gap-4">
                  <a href={`https://mempool.space/tx/${lastTxid}`} target="_blank" className="text-[0.65rem] font-cinzel text-[#c9a040] hover:text-[#f5c842] transition-colors uppercase tracking-widest flex items-center gap-1">
                    View Tx <ExternalLink size={10} />
                  </a>
                  <div className="w-1 h-1 rounded-full bg-[#3a2808]" />
                  <a href={`https://ord.io/${lastTxid}i0`} target="_blank" className="text-[0.65rem] font-cinzel text-[#c9a040] hover:text-[#f5c842] transition-colors uppercase tracking-widest flex items-center gap-1">
                    View Ord <ExternalLink size={10} />
                  </a>
                </div>
              </div>

              <button 
                onClick={() => setShowCongrats(false)}
                className="w-full py-4 rounded-xl bg-gradient-to-r from-[#c9a040] to-[#f5c842] text-black font-cinzel font-bold text-[0.8rem] tracking-[0.2em] uppercase hover:opacity-90 transition-all shadow-[0_0_20px_rgba(201,160,64,0.3)]"
              >
                Return to the Well
              </button>
            </motion.div>
          </motion.div>
        )}

        {showWalletSelect && (
          <motion.div 
            initial={{ opacity: 0 }} 
            animate={{ opacity: 1 }} 
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[10000] flex items-center justify-center px-4 bg-black/80 backdrop-blur-sm"
          >
            <motion.div 
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.9, y: 20 }}
              className="bg-[#1a120a] border border-[#f5c842]/30 rounded-2xl p-6 max-w-[320px] w-full shadow-[0_0_50px_rgba(0,0,0,0.5)]"
            >
              <div className="flex justify-between items-center mb-6">
                <h3 className="font-cinzel text-[#f5c842] tracking-widest uppercase text-sm">Connect Wallet</h3>
                <button onClick={() => setShowWalletSelect(false)} className="text-[#7a5a25] hover:text-[#f5c842] transition-colors"><X size={20} /></button>
              </div>
              
              <div className="space-y-3">
                <button 
                  onClick={connectXverse}
                  className="w-full bg-gradient-to-br from-[#1c1208] to-[#130d05] border border-[#3a2808] rounded-xl p-4 text-[#b09040] font-cinzel text-[0.8rem] font-bold tracking-wider hover:border-[#c9a040] hover:text-[#f5c842] transition-all uppercase flex items-center justify-between group"
                >
                  <div className="flex items-center gap-3">
                    <span className="text-2xl">🔶</span>
                    <span>Xverse</span>
                  </div>
                  <ChevronDown size={16} className="-rotate-90 opacity-0 group-hover:opacity-100 transition-all" />
                </button>
                <button 
                  onClick={connectUnisat}
                  className="w-full bg-gradient-to-br from-[#1c1208] to-[#130d05] border border-[#3a2808] rounded-xl p-4 text-[#b09040] font-cinzel text-[0.8rem] font-bold tracking-wider hover:border-[#c9a040] hover:text-[#f5c842] transition-all uppercase flex items-center justify-between group"
                >
                  <div className="flex items-center gap-3">
                    <span className="text-2xl">🔷</span>
                    <span>UniSat</span>
                  </div>
                  <ChevronDown size={16} className="-rotate-90 opacity-0 group-hover:opacity-100 transition-all" />
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}

        {showConfirm && (
          <motion.div 
            initial={{ opacity: 0 }} 
            animate={{ opacity: 1 }} 
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[10000] flex items-center justify-center px-4 bg-black/80 backdrop-blur-sm"
          >
            <motion.div 
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.9, y: 20 }}
              className="bg-[#1a120a] border border-[#f5c842]/30 rounded-2xl p-6 max-w-md w-full shadow-[0_0_50px_rgba(0,0,0,0.5)]"
            >
              <h3 className="font-cinzel text-[#f5c842] text-center tracking-widest uppercase mb-6 flex items-center justify-center gap-2">
                <AlertTriangle size={18} /> Confirm Inscription
              </h3>
              
              <div className="space-y-4 mb-8 text-[0.85rem]">
                <div className="flex justify-between border-b border-[#3a2808] pb-2">
                  <span className="text-[#7a5a25] uppercase font-cinzel text-[0.65rem] tracking-wider">Content</span>
                  <span className="text-[#e8d5a3] truncate max-w-[200px] font-medium">
                    {selFile ? `File: ${selFile.name}` : wishText ? 'Text Wish' : 'Empty Wish'}
                  </span>
                </div>
                <div className="flex justify-between border-b border-[#3a2808] pb-2">
                  <span className="text-[#7a5a25] uppercase font-cinzel text-[0.65rem] tracking-wider">Fee Rate</span>
                  <span className="text-[#c9a040] font-medium">{feeRates[selRate]} sats/vB</span>
                </div>
                <div className="flex justify-between border-b border-[#3a2808] pb-2">
                  <span className="text-[#7a5a25] uppercase font-cinzel text-[0.65rem] tracking-wider">Network Fee</span>
                  <span className="text-[#c9a040] font-medium">{netFee.toLocaleString()} sats</span>
                </div>
                {regOn && (
                  <div className="flex justify-between border-b border-[#3a2808] pb-2">
                    <span className="text-[#7a5a25] uppercase font-cinzel text-[0.65rem] tracking-wider">Registry Fee</span>
                    <span className="text-[#c9a040] font-medium">{REG_FEE.toLocaleString()} sats</span>
                  </div>
                )}
                <div className="flex justify-between pt-2">
                  <span className="text-[#f5c842] uppercase font-cinzel font-bold tracking-widest">Total Due</span>
                  <span className="text-[#f5c842] font-bold text-lg">{totalFee.toLocaleString()} sats</span>
                </div>
              </div>

              <div className="flex gap-3">
                <button 
                  onClick={() => setShowConfirm(false)}
                  className="flex-1 py-3 border border-[#3a2808] rounded-xl text-[#7a5a25] font-cinzel uppercase text-[0.7rem] tracking-widest hover:bg-white/5 transition-colors"
                >
                  Cancel
                </button>
                <button 
                  onClick={() => { setShowConfirm(false); executeInscribe(); }}
                  className="flex-1 py-3 bg-gradient-to-br from-[#f5c842] to-[#c9a040] rounded-xl text-black font-cinzel font-bold uppercase text-[0.7rem] tracking-widest hover:brightness-110 transition-all shadow-[0_4px_12px_rgba(245,200,66,0.2)]"
                >
                  Confirm
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
