import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { LucideIcon, Coins, Scroll, Upload, X, Check, AlertTriangle, ExternalLink, Wallet } from 'lucide-react';
import { ThreeWell } from './components/ThreeWell';
import { PlungeSplash } from './components/PlungeSplash';
import { Inscription, FeeTier, FeeRates, WalletType } from './types';
import { fetchFeeRates, fetchBalance, toB64, loadSatsConnect, DEV_ADDR, REG_FEE } from './services/bitcoinService';

const REG_KEY = 'bww_mainnet_v1';

export default function App() {
  const [view, setView] = useState<'intro' | 'plunge' | 'ui'>('intro');
  const [tab, setTab] = useState<'cast' | 'inscriptions'>('cast');
  const [inscriptions, setInscriptions] = useState<Inscription[]>([]);
  const [selFile, setSelFile] = useState<File | null>(null);
  const [wishText, setWishText] = useState('');
  const [feeRates, setFeeRates] = useState<FeeRates>({ slow: 10, med: 20, fast: 40 });
  const [selRate, setSelRate] = useState<FeeTier>('med');
  const [regOn, setRegOn] = useState(false);
  const [wallet, setWallet] = useState<{ type: WalletType; ordAddr: string; payAddr: string; balance: number } | null>(null);
  const [status, setStatus] = useState<{ type: 'ok' | 'err' | 'info'; msg: string } | null>(null);
  const [progress, setProgress] = useState<{ p: number; l: string } | null>(null);

  useEffect(() => {
    const saved = localStorage.getItem(REG_KEY);
    if (saved) setInscriptions(JSON.parse(saved));
    fetchFeeRates().then(setFeeRates);
  }, []);

  const saveInscriptions = (list: Inscription[]) => {
    setInscriptions(list);
    localStorage.setItem(REG_KEY, JSON.stringify(list.slice(0, 500)));
  };

  const updateBalance = async (addr: string) => {
    const bal = await fetchBalance(addr);
    if (wallet) setWallet({ ...wallet, balance: bal });
  };

  const connectXverse = async () => {
    try {
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

  const handleInscribe = async () => {
    if (!wallet) return;
    setProgress({ p: 0, l: 'Preparing inscription...' });
    try {
      let contentType, contentB64;
      if (selFile) {
        const rawB64 = await toB64(selFile);
        if (wishText) {
          const meta = { wish: wishText, fileName: selFile.name, fileType: selFile.type, fileData: rawB64, app: 'bitcoin-wishing-well-v1', registry: regOn };
          contentType = 'application/json'; contentB64 = btoa(JSON.stringify(meta));
        } else {
          contentType = selFile.type || 'application/octet-stream'; contentB64 = rawB64;
        }
      } else {
        const meta = { wish: wishText, app: 'bitcoin-wishing-well-v1', registry: regOn };
        contentType = 'application/json'; contentB64 = btoa(JSON.stringify(meta));
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
      };

      saveInscriptions([newIns, ...inscriptions]);
      setStatus({ type: 'ok', msg: 'Wish inscribed! Tx: ' + result.wishTxid });
      setProgress(null);
      setTab('inscriptions');
    } catch (err: any) {
      setStatus({ type: 'err', msg: 'Failed: ' + err.message });
      setProgress(null);
    }
  };

  const vBytes = Math.round(160 + 160 + (selFile ? selFile.size : new TextEncoder().encode(wishText).length) / 4);
  const netFee = vBytes * feeRates[selRate];
  const totalFee = netFee + (regOn ? REG_FEE : 0);

  return (
    <div className="min-h-screen bg-black text-[#e8d5a3] font-lora">
      <nav className="fixed top-0 left-0 right-0 z-[9999] flex items-center justify-between px-8 py-3 bg-[rgba(6,4,1,0.95)] border-b border-[rgba(245,200,66,0.1)] backdrop-blur-xl">
        <a href="/" className="nav-logo font-cinzel-decorative text-base text-[#f5c842] tracking-widest">⊕ Bitcoin Wishing Well</a>
        <div className="flex items-center gap-3">
          <span className="hidden sm:block font-cinzel text-[0.63rem] font-semibold tracking-widest uppercase text-[#7a5a25] border border-[rgba(245,200,66,0.15)] rounded-full px-3 py-1">Ordinals</span>
          <span className="nav-live font-cinzel text-[0.63rem] font-bold tracking-widest uppercase text-[#50a860] border border-[rgba(80,168,96,0.3)] bg-[rgba(80,168,96,0.07)] rounded-full px-4 py-1 flex items-center gap-2">Mainnet</span>
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
                  <button onClick={() => setTab('cast')} className={`flex-1 flex items-center justify-center gap-2 font-cinzel text-[0.68rem] font-semibold tracking-widest uppercase py-2 rounded-lg transition-all ${tab === 'cast' ? 'text-[#f5c842] bg-[rgba(245,200,66,0.1)] border border-[rgba(245,200,66,0.22)]' : 'text-[#7a5a25] hover:text-[#c9a040]'}`}>
                    <Coins size={14} /> Cast a Wish
                  </button>
                  <button onClick={() => setTab('inscriptions')} className={`flex-1 flex items-center justify-center gap-2 font-cinzel text-[0.68rem] font-semibold tracking-widest uppercase py-2 rounded-lg transition-all ${tab === 'inscriptions' ? 'text-[#f5c842] bg-[rgba(245,200,66,0.1)] border border-[rgba(245,200,66,0.22)]' : 'text-[#7a5a25] hover:text-[#c9a040]'}`}>
                    <Scroll size={14} /> Inscriptions <span className="bg-[rgba(245,200,66,0.15)] border border-[rgba(245,200,66,0.28)] rounded-full text-[0.58rem] px-1.5 min-w-[18px] text-center">{inscriptions.length}</span>
                  </button>
                </div>

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
                      {regOn && <div className="flex justify-between text-[0.72rem] font-cinzel text-[#6a4a20] tracking-wider"><span>Registry fee</span><span className="text-[#c9a040]">{REG_FEE.toLocaleString()} sats</span></div>}
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
                    {inscriptions.length === 0 ? (
                      <div className="text-center py-12 text-[#3a2808] italic text-[0.85rem]">
                        <Coins size={48} className="mx-auto mb-3 opacity-35" />
                        Cast your first wish to see it inscribed here.
                      </div>
                    ) : (
                      inscriptions.map((ins, i) => (
                        <div key={i} className="bg-gradient-to-br from-[#130e06] to-[#0d0804] border border-[#2a1a08] rounded-xl p-4 relative overflow-hidden group hover:border-[#3a2a12] transition-all">
                          <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-[rgba(245,200,66,0.18)] to-transparent" />
                          <div className="flex items-start justify-between gap-3 mb-2">
                            <p className="text-[0.84rem] text-[#d4a040] italic leading-relaxed flex-1">"{ins.wish}"</p>
                            <div className="flex items-center gap-1.5 shrink-0 pt-1">
                              <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[0.72rem] font-bold border ${ins.registered ? 'bg-[rgba(50,160,80,0.14)] border-[rgba(80,210,100,0.38)] text-[#55d070]' : 'bg-[rgba(100,80,20,0.1)] border-[rgba(120,90,20,0.22)] text-[#6a5020]'}`}>{ins.registered ? '✓' : '·'}</div>
                              <span className={`font-cinzel text-[0.62rem] tracking-wider uppercase ${ins.registered ? 'text-[#50a860]' : 'text-[#5a4018]'}`}>{ins.registered ? 'Registered' : 'Unregistered'}</span>
                            </div>
                          </div>
                          <div className="flex flex-wrap gap-2 items-center mb-2">
                            <span className="bg-[rgba(180,120,20,0.1)] border border-[rgba(180,120,20,0.2)] text-[#8a6020] text-[0.6rem] rounded px-2 py-0.5 font-cinzel tracking-wider uppercase">{(ins.contentType.split('/')[1] || ins.contentType).toUpperCase()}</span>
                            <span className="bg-[rgba(40,120,40,0.08)] border border-[rgba(40,180,60,0.2)] text-[#40a050] text-[0.6rem] rounded px-2 py-0.5 font-cinzel tracking-wider uppercase">Mainnet ₿</span>
                          </div>
                          <div className="flex flex-wrap gap-2 items-center text-[0.65rem]">
                            <span className="font-cinzel text-[0.58rem] text-[#3a2408] tracking-widest uppercase">Inscription</span>
                            <a href={`https://ordinals.com/inscription/${ins.wishTxid}`} target="_blank" className="text-[#4a3018] font-mono hover:text-[#c9a040] hover:underline truncate max-w-[120px]">{ins.wishTxid.slice(0, 8)}...{ins.wishTxid.slice(-8)}</a>
                            <span className="text-[#3a2808] ml-auto">{new Date(ins.timestamp).toLocaleDateString()}</span>
                          </div>
                        </div>
                      ))
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
    </div>
  );
}
