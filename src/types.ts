export interface Inscription {
  wish: string;
  contentType: string;
  wishTxid: string;
  regTxid: string | null;
  address: string;
  timestamp: number;
  registered?: boolean;
  serviceFee?: number;
  feeRate: number;
  isDemo?: boolean;
  status?: 'pending' | 'confirmed' | 'failed';
  creatorUid: string;
  contentB64?: string;
}

export interface Profile {
  address: string;
  displayName: string;
  twitterUrl: string;
  bio: string;
  verifiedAt: number;
  updatedAt: number;
}

export interface ChatMessage {
  id: string;
  address: string;
  text: string;
  timestamp: number;
}

export type FeeTier = 'slow' | 'med' | 'fast' | 'custom';

export interface FeeRates {
  slow: number;
  med: number;
  fast: number;
}

export type WalletType = 'xverse' | 'unisat';
