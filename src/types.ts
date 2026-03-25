export interface Inscription {
  wish: string;
  contentType: string;
  wishTxid: string;
  regTxid: string | null;
  address: string;
  timestamp: number;
  registered: boolean;
  feeRate: number;
  isDemo?: boolean;
  status?: 'pending' | 'confirmed' | 'failed';
  creatorUid: string;
  contentB64?: string;
}

export type FeeTier = 'slow' | 'med' | 'fast' | 'custom';

export interface FeeRates {
  slow: number;
  med: number;
  fast: number;
}

export type WalletType = 'xverse' | 'unisat';
