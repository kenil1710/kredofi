// The provider server signers send through. FailoverRpcProvider wraps every error in "Exceeded N
// providers", which hides InvalidNonceError from near-api-js's Account: its own fix (forget the cached
// nonce, re-read it, re-sign) only runs for an InvalidNonceError. So once anything else signed with the
// same key (a devcheck script, a manual top-up), the cached nonce stayed behind and each relayer
// request failed, catching up one nonce per failure (bug Nov 9: faucet 502 four times in a row).
// Unwrapping it lets Account retry. A rejected nonce means the transaction never ran, so a retry is safe.
import { FailoverRpcProvider } from 'near-api-js';
import { InvalidNonceError } from 'near-api-js/rpc-errors';

export class SigningProvider extends FailoverRpcProvider {
  override async sendTransactionUntil(...args: Parameters<FailoverRpcProvider['sendTransactionUntil']>) {
    try {
      return await super.sendTransactionUntil(...args);
    } catch (e) {
      const nonce = (e as { errors?: unknown[] }).errors?.find((x) => x instanceof InvalidNonceError);
      throw nonce ?? e;
    }
  }
}
