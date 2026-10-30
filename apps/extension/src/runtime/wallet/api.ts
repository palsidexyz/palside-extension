import type { Api } from '../transport/api';
import type { WalletApiPort, WalletRelayResult } from './controller';

export function walletApi(api: Api): WalletApiPort {
  return {
    config: () => api.request('chain.config'),
    balance: () => api.request('chain.balance'),
    price: () => api.request('chain.price'),
    records: query => api.request('chain.records', { query }),
    recovery: query => api.request('chain.recovery', { query }),
    quote: (body, key) => api.request('chain.orders', { body, key }),
    order: id => api.request('chain.order', { params: { id } }),
    prepare: async (orderId, key) => await api.request('chain.relayPrepare', { body: { orderId }, key }) as WalletRelayResult,
    submit: async (_orderId, body, key) => await api.request('chain.relaySubmit', { body, key }) as WalletRelayResult,
    status: async id => await api.request('chain.relayStatus', { params: { id } }) as WalletRelayResult,
    cancel: async (id, key) => await api.request('chain.relayCancel', { params: { id }, key }) as WalletRelayResult,
  };
}
