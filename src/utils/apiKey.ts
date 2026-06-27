import crypto from 'crypto';

export const generateApiKey = (type: 'live' | 'test' = 'live'): { key: string; prefix: string } => {
  const secret = crypto.randomBytes(32).toString('hex');
  const prefix = `sk_${type}`;
  const key = `${prefix}_${secret}`;
  return { key, prefix };
};
