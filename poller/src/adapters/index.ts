import * as statuspage from './statuspage';
import * as microsoft from './microsoft';
import * as google from './google';
import * as aws from './aws';
import * as apple from './apple';
import * as librenms from './librenms';
import * as ellucian from './ellucian';

interface StatusAdapter {
  fetchStatus: (endpoint: string) => Promise<any>;
  normalizeStatus: (data: any) => { status: string; message: string };
}

export const adapters: { [key: string]: StatusAdapter } = {
  'statuspage': statuspage,
  'microsoft_graph': microsoft,
  'google_status': google,
  'aws_status': aws,
  'apple_status': apple,
  'librenms': librenms,
  'ellucian': ellucian,
  'manual': {
    fetchStatus: async () => ({}),
    normalizeStatus: () => ({ status: 'operational', message: 'Manual status only' })
  }
};

export function getAdapter(apiType: string): StatusAdapter {
  return adapters[apiType] || adapters['statuspage'];
}
