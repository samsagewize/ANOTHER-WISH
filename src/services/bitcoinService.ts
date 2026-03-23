import { FeeRates, WalletType } from '../types';

const MEMPOOL = 'https://mempool.space/api';
export const DEV_ADDR = '3FxKYyYJcxn6Tx2RvQM8szTzYKTQYskgWq';
export const REG_FEE = 2000;

export async function fetchFeeRates(): Promise<FeeRates> {
  try {
    const r = await fetch('https://mempool.space/api/v1/fees/recommended');
    if (!r.ok) throw new Error();
    const d = await r.json();
    return { slow: d.hourFee, med: d.halfHourFee, fast: d.fastestFee };
  } catch (e) {
    return { slow: 1, med: 2, fast: 4 };
  }
}

export async function fetchBalance(addr: string): Promise<number> {
  try {
    const r = await fetch(`${MEMPOOL}/address/${addr}`);
    if (r.ok) {
      const d = await r.json();
      return (d.chain_stats?.funded_txo_sum || 0) - (d.chain_stats?.spent_txo_sum || 0);
    }
    return 0;
  } catch (e) {
    return 0;
  }
}

export const toB64 = (f: File): Promise<string> => new Promise((res, rej) => {
  const r = new FileReader();
  r.onload = e => res((e.target?.result as string).split(',')[1]);
  r.onerror = () => rej(new Error('File read failed'));
  r.readAsDataURL(f);
});

// sats-connect v2 lazy loader
let _sc: any = null;
export async function loadSatsConnect() {
  if (_sc) return _sc;
  // @ts-ignore
  _sc = await import('https://esm.sh/sats-connect@2');
  return _sc;
}
