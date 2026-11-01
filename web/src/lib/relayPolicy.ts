// What the no-wallet relayer will pay for (SPEC 8a). Pure and unit-tested (relayPolicy.test.ts):
// the relayer signs and pays gas for these meta transactions, so this is the only gate.

export type DecodedAction = Record<string, unknown>;
export type DecodedDelegate = { senderId: string; receiverId: string; actions: DecodedAction[] };
export type RelayConfig = { relayer: string; kredofi: string; usdc: string };

const MAX_GAS = 100n * 10n ** 12n;
const ONE_YOCTO = 1n;
const MAX_STORAGE_DEPOSIT = 12_500_000_000_000_000_000_000n; // 0.0125 NEAR

export const isDemoAccount = (id: string, relayer: string) =>
  id.endsWith(`.${relayer}`) && /^demo\d{6,16}$/.test(id.slice(0, -relayer.length - 1));

function argsJson(args: unknown): Record<string, unknown> | null {
  try {
    const bytes = args instanceof Uint8Array ? args : Uint8Array.from(args as number[]);
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch { return null; }
}

/** null if the delegate may be relayed, otherwise the reason it is refused. */
export function checkDelegate(d: DecodedDelegate, cfg: RelayConfig): string | null {
  if (!isDemoAccount(d.senderId, cfg.relayer)) return 'Only KredoFi demo accounts can use the relayer.';
  if (d.receiverId !== cfg.kredofi && d.receiverId !== cfg.usdc) return 'The relayer only calls KredoFi and test USDC.';
  if (d.actions.length !== 1) return 'One action per request.';
  const a = d.actions[0];
  const keys = Object.keys(a);
  if (keys.length !== 1 || keys[0] !== 'functionCall') return 'Only contract calls can be relayed.';
  const fc = a.functionCall as { methodName: string; args: unknown; gas: bigint | number | string; deposit: bigint | number | string };
  const gas = BigInt(fc.gas), deposit = BigInt(fc.deposit);
  if (gas > MAX_GAS) return 'Too much gas requested.';
  const args = argsJson(fc.args);
  if (!args) return 'Arguments must be JSON.';

  if (d.receiverId === cfg.kredofi) {
    if (fc.methodName !== 'borrow') return `The relayer does not call ${fc.methodName}.`;
    if (deposit !== ONE_YOCTO) return 'borrow needs exactly 1 yoctoNEAR.';
    if (typeof args.amount !== 'string' || !/^\d{1,20}$/.test(args.amount)) return 'Invalid amount.';
    return null;
  }
  // test USDC
  if (fc.methodName === 'ft_transfer_call') {
    if (deposit !== ONE_YOCTO) return 'ft_transfer_call needs exactly 1 yoctoNEAR.';
    if (args.receiver_id !== cfg.kredofi) return 'Test USDC can only be sent to KredoFi.';
    if (args.msg !== 'repay' && args.msg !== 'deposit') return 'Only repay or deposit.';
    if (typeof args.amount !== 'string' || !/^\d{1,20}$/.test(args.amount)) return 'Invalid amount.';
    return null;
  }
  if (fc.methodName === 'storage_deposit') {
    if (deposit > MAX_STORAGE_DEPOSIT) return 'Storage deposit too large.';
    return null;
  }
  return `The relayer does not call ${fc.methodName}.`;
}
